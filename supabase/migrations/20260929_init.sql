-- Pantry Tracker Initial Schema
-- Row Level Security enabled on all tables WITHOUT policies:
-- Client anon key cannot access tables directly.
-- All data access is mediated by the backend Edge Function with service role privileges.

-- 1. Users
create table if not exists users (
  telegram_id bigint primary key,
  first_name text,
  username text,
  language_code text default 'ru',
  timezone text not null default 'Europe/Moscow',
  reminder_hour smallint not null default 9 check (reminder_hour between 0 and 23),
  reminders_enabled boolean not null default true,
  can_write_pm boolean not null default false,
  created_at timestamptz default now()
);

-- 2. Whitelist of permitted users
create table if not exists allowed_users (
  telegram_id bigint primary key,
  note text
);

-- 3. Pantries
create table if not exists pantries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 4. Pantry members (role: owner or member)
create table if not exists pantry_members (
  pantry_id uuid references pantries(id) on delete cascade,
  user_id bigint references users(telegram_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (pantry_id, user_id)
);

-- 5. Pantry invite codes (>=16 chars, max_uses, expires_at)
create table if not exists pantry_invites (
  code text primary key,
  pantry_id uuid references pantries(id) on delete cascade,
  created_by bigint references users(telegram_id),
  expires_at timestamptz not null,
  max_uses int not null default 1,
  uses int not null default 0
);

-- 6. Global products catalog (barcode -> name, source: manual or off)
create table if not exists products (
  barcode text primary key,
  name text not null,
  source text not null default 'manual' check (source in ('manual', 'off')),
  updated_at timestamptz default now()
);

-- 7. Items stored in pantries
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  pantry_id uuid not null references pantries(id) on delete cascade,
  barcode text,
  name text not null,
  expiration_date date not null,
  quantity int not null default 1 check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'consumed', 'discarded')),
  created_by bigint references users(telegram_id),
  created_at timestamptz default now(),
  closed_at timestamptz
);

create index if not exists idx_items_pantry_status_exp on items (pantry_id, status, expiration_date);

-- 8. Reminders deduplication log per user, item, and stage (stages: 1, 2, 3)
create table if not exists reminder_log (
  user_id bigint references users(telegram_id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  stage smallint not null check (stage in (1, 2, 3)),
  sent_at timestamptz default now(),
  primary key (user_id, item_id, stage)
);

-- STRICT SECURITY: Enable RLS on all tables with zero client policies
alter table users enable row level security;
alter table allowed_users enable row level security;
alter table pantries enable row level security;
alter table pantry_members enable row level security;
alter table pantry_invites enable row level security;
alter table products enable row level security;
alter table items enable row level security;
alter table reminder_log enable row level security;

-- 9. Atomic Operations for Pantry Items (Concurrency & Race-condition safe)

-- Atomic Consume Item with row-level locking
create or replace function consume_pantry_item(
  p_item_id uuid,
  p_action text default 'consumed',
  p_all boolean default false
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_item items%rowtype;
  v_prev_qty int;
  v_prev_status text;
  v_prev_closed timestamptz;
begin
  -- Row lock to prevent concurrent decrement race conditions
  select * into v_item
  from items
  where id = p_item_id
  for update;

  if not found or v_item.status != 'active' then
    return null;
  end if;

  v_prev_qty := v_item.quantity;
  v_prev_status := v_item.status;
  v_prev_closed := v_item.closed_at;

  if v_item.quantity > 1 and not p_all then
    update items
    set quantity = quantity - 1
    where id = p_item_id
    returning * into v_item;
  else
    update items
    set status = p_action,
        closed_at = now()
    where id = p_item_id
    returning * into v_item;
  end if;

  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'previousState', jsonb_build_object(
      'id', p_item_id,
      'quantity', v_prev_qty,
      'status', v_prev_status,
      'closed_at', v_prev_closed
    )
  );
end;
$$;

-- Atomic Merge or Create Item with row-level locking
create or replace function merge_or_create_item(
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
as $$
declare
  v_item items%rowtype;
begin
  -- Lock candidate active batch
  select * into v_item
  from items
  where pantry_id = p_pantry_id
    and expiration_date = p_expiration_date
    and status = 'active'
    and (
      (p_barcode is not null and barcode = p_barcode) or
      (p_barcode is null and barcode is null and lower(name) = lower(p_name))
    )
  for update;

  if found then
    update items
    set quantity = quantity + p_quantity
    where id = v_item.id
    returning * into v_item;
    return jsonb_build_object('item', to_jsonb(v_item), 'merged', true);
  else
    insert into items (pantry_id, barcode, name, expiration_date, quantity, status, created_by)
    values (p_pantry_id, p_barcode, p_name, p_expiration_date, p_quantity, 'active', p_created_by)
    returning * into v_item;
    return jsonb_build_object('item', to_jsonb(v_item), 'merged', false);
  end if;
end;
$$;

-- Atomic Register or Update User with strict 10-user limit
create or replace function register_user_with_limit(
  p_telegram_id bigint,
  p_first_name text,
  p_username text,
  p_language_code text,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user users%rowtype;
  v_count int;
begin
  -- If user already registered, update profile and return
  select * into v_user from users where telegram_id = p_telegram_id;
  if found then
    update users
    set first_name = p_first_name,
        username = p_username,
        language_code = coalesce(p_language_code, language_code),
        timezone = coalesce(p_timezone, timezone)
    where telegram_id = p_telegram_id
    returning * into v_user;
    return jsonb_build_object('user', to_jsonb(v_user), 'is_new', false);
  end if;

  -- Transaction-level advisory lock serializes concurrent new-user registrations
  perform pg_advisory_xact_lock(737373);
  select count(*) into v_count from users;
  if v_count >= 10 then
    return jsonb_build_object('error', 'USER_LIMIT_REACHED');
  end if;

  insert into users (telegram_id, first_name, username, language_code, timezone)
  values (p_telegram_id, p_first_name, p_username, coalesce(p_language_code, 'ru'), coalesce(p_timezone, 'Europe/Moscow'))
  returning * into v_user;

  return jsonb_build_object('user', to_jsonb(v_user), 'is_new', true);
end;
$$;

-- Atomic Join Pantry via Invite Code with row-level locking
create or replace function join_pantry_via_invite(
  p_code text,
  p_user_id bigint
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_invite pantry_invites%rowtype;
  v_pantry pantries%rowtype;
  v_member pantry_members%rowtype;
begin
  -- 1. Row lock the invite to prevent concurrent exhaustion races
  select * into v_invite
  from pantry_invites
  where code = p_code
  for update;

  if not found then
    return jsonb_build_object('error', 'INVITE_NOT_FOUND');
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('error', 'INVITE_EXPIRED');
  end if;

  -- 2. Check if already a member
  select * into v_member
  from pantry_members
  where pantry_id = v_invite.pantry_id and user_id = p_user_id;

  if found then
    select * into v_pantry from pantries where id = v_invite.pantry_id;
    return jsonb_build_object('pantry', to_jsonb(v_pantry), 'already_member', true);
  end if;

  -- 3. Check remaining uses under row lock
  if v_invite.uses >= v_invite.max_uses then
    return jsonb_build_object('error', 'INVITE_EXHAUSTED');
  end if;

  -- 4. Atomically insert member and increment uses
  insert into pantry_members (pantry_id, user_id, role)
  values (v_invite.pantry_id, p_user_id, 'member');

  update pantry_invites
  set uses = uses + 1
  where code = p_code;

  select * into v_pantry from pantries where id = v_invite.pantry_id;
  return jsonb_build_object('pantry', to_jsonb(v_pantry), 'already_member', false);
end;
$$;
