-- ==========================================================================
-- Migration: 20260930_rpc_security_hardening.sql
-- PostgreSQL RPC Security Hardening (Defense-in-Depth)
-- ==========================================================================
-- Threat model:
--   PostgREST exposes public schema functions via /rpc/<name>.
--   SECURITY DEFINER functions execute with the privileges of the owner,
--   bypassing Row Level Security (RLS) entirely.
--   If search_path is mutable or unqualified objects are used, an attacker
--   could exploit search_path hijacking.
--   Furthermore, without explicit REVOKE, `anon` and `authenticated` roles
--   can invoke these functions directly via PostgREST, bypassing Edge Functions.
--
-- Security Controls Enforced:
--   1. SET search_path = '' on all SECURITY DEFINER functions to prevent hijacking.
--   2. Explicit schema qualification (public.* and pg_catalog.*) on all table/function refs.
--   3. REVOKE EXECUTE FROM public, anon, authenticated.
--   4. GRANT EXECUTE exclusively to service_role (used by backend Edge Functions).
--   5. ALTER DEFAULT PRIVILEGES to revoke execute from public, anon, authenticated.
-- ==========================================================================

-- 1. consume_pantry_item
create or replace function public.consume_pantry_item(
  p_item_id uuid,
  p_action text default 'consumed',
  p_all boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_prev_qty int;
  v_prev_status text;
  v_prev_closed timestamptz;
begin
  -- Row lock to prevent concurrent decrement race conditions
  select * into v_item
  from public.items
  where id = p_item_id
  for update;

  if not found or v_item.status != 'active' then
    return null;
  end if;

  v_prev_qty := v_item.quantity;
  v_prev_status := v_item.status;
  v_prev_closed := v_item.closed_at;

  if v_item.quantity > 1 and not p_all then
    update public.items
    set quantity = quantity - 1
    where id = p_item_id
    returning * into v_item;
  else
    update public.items
    set status = p_action,
        closed_at = pg_catalog.now()
    where id = p_item_id
    returning * into v_item;
  end if;

  return pg_catalog.jsonb_build_object(
    'item', pg_catalog.to_jsonb(v_item),
    'previousState', pg_catalog.jsonb_build_object(
      'id', p_item_id,
      'quantity', v_prev_qty,
      'status', v_prev_status,
      'closed_at', v_prev_closed
    )
  );
end;
$$;

revoke execute on function public.consume_pantry_item(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.consume_pantry_item(uuid, text, boolean) to service_role;

-- 2. merge_or_create_item
create or replace function public.merge_or_create_item(
  p_pantry_id uuid,
  p_barcode text,
  p_name text,
  p_expiration_date date,
  p_quantity int,
  p_created_by bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  -- Lock candidate active batch
  select * into v_item
  from public.items
  where pantry_id = p_pantry_id
    and expiration_date = p_expiration_date
    and status = 'active'
    and (
      (p_barcode is not null and barcode = p_barcode) or
      (p_barcode is null and barcode is null and pg_catalog.lower(name) = pg_catalog.lower(p_name))
    )
  for update;

  if found then
    update public.items
    set quantity = quantity + p_quantity
    where id = v_item.id
    returning * into v_item;
    return pg_catalog.jsonb_build_object('item', pg_catalog.to_jsonb(v_item), 'merged', true);
  else
    insert into public.items (pantry_id, barcode, name, expiration_date, quantity, status, created_by)
    values (p_pantry_id, p_barcode, p_name, p_expiration_date, p_quantity, 'active', p_created_by)
    returning * into v_item;
    return pg_catalog.jsonb_build_object('item', pg_catalog.to_jsonb(v_item), 'merged', false);
  end if;
end;
$$;

revoke execute on function public.merge_or_create_item(uuid, text, text, date, int, bigint) from public, anon, authenticated;
grant execute on function public.merge_or_create_item(uuid, text, text, date, int, bigint) to service_role;

-- 3. register_user_with_limit
create or replace function public.register_user_with_limit(
  p_telegram_id bigint,
  p_first_name text,
  p_username text,
  p_language_code text,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_count int;
begin
  -- If user already registered, update profile and return
  select * into v_user from public.users where telegram_id = p_telegram_id;
  if found then
    update public.users
    set first_name = p_first_name,
        username = p_username,
        language_code = pg_catalog.coalesce(p_language_code, language_code),
        timezone = pg_catalog.coalesce(p_timezone, timezone)
    where telegram_id = p_telegram_id
    returning * into v_user;
    return pg_catalog.jsonb_build_object('user', pg_catalog.to_jsonb(v_user), 'is_new', false);
  end if;

  -- Transaction-level advisory lock serializes concurrent new-user registrations
  perform pg_catalog.pg_advisory_xact_lock(737373);
  select pg_catalog.count(*) into v_count from public.users;
  if v_count >= 10 then
    return pg_catalog.jsonb_build_object('error', 'USER_LIMIT_REACHED');
  end if;

  insert into public.users (telegram_id, first_name, username, language_code, timezone)
  values (p_telegram_id, p_first_name, p_username, pg_catalog.coalesce(p_language_code, 'ru'), pg_catalog.coalesce(p_timezone, 'Europe/Moscow'))
  returning * into v_user;

  return pg_catalog.jsonb_build_object('user', pg_catalog.to_jsonb(v_user), 'is_new', true);
end;
$$;

revoke execute on function public.register_user_with_limit(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_user_with_limit(bigint, text, text, text, text) to service_role;

-- 4. join_pantry_via_invite
create or replace function public.join_pantry_via_invite(
  p_code text,
  p_user_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.pantry_invites%rowtype;
  v_pantry public.pantries%rowtype;
  v_member public.pantry_members%rowtype;
begin
  -- 1. Row lock the invite to prevent concurrent exhaustion races
  select * into v_invite
  from public.pantry_invites
  where code = p_code
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('error', 'INVITE_NOT_FOUND');
  end if;

  if v_invite.expires_at < pg_catalog.now() then
    return pg_catalog.jsonb_build_object('error', 'INVITE_EXPIRED');
  end if;

  -- 2. Check if already a member
  select * into v_member
  from public.pantry_members
  where pantry_id = v_invite.pantry_id and user_id = p_user_id;

  if found then
    select * into v_pantry from public.pantries where id = v_invite.pantry_id;
    return pg_catalog.jsonb_build_object('pantry', pg_catalog.to_jsonb(v_pantry), 'already_member', true);
  end if;

  -- 3. Check remaining uses under row lock
  if v_invite.uses >= v_invite.max_uses then
    return pg_catalog.jsonb_build_object('error', 'INVITE_EXHAUSTED');
  end if;

  -- 4. Atomically insert member and increment uses
  insert into public.pantry_members (pantry_id, user_id, role)
  values (v_invite.pantry_id, p_user_id, 'member');

  update public.pantry_invites
  set uses = uses + 1
  where code = p_code;

  select * into v_pantry from public.pantries where id = v_invite.pantry_id;
  return pg_catalog.jsonb_build_object('pantry', pg_catalog.to_jsonb(v_pantry), 'already_member', false);
end;
$$;

revoke execute on function public.join_pantry_via_invite(text, bigint) from public, anon, authenticated;
grant execute on function public.join_pantry_via_invite(text, bigint) to service_role;

-- 5. create_pantry_with_owner
create or replace function public.create_pantry_with_owner(
  p_name text,
  p_owner_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pantry public.pantries%rowtype;
begin
  insert into public.pantries (name)
  values (p_name)
  returning * into v_pantry;

  insert into public.pantry_members (pantry_id, user_id, role)
  values (v_pantry.id, p_owner_id, 'owner');

  return pg_catalog.to_jsonb(v_pantry);
end;
$$;

revoke execute on function public.create_pantry_with_owner(text, bigint) from public, anon, authenticated;
grant execute on function public.create_pantry_with_owner(text, bigint) to service_role;

-- 6. Defense-in-depth: revoke execute by default on any future functions created in schema public
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
