-- ==========================================================================
-- Migration: RPC Security Hardening (Defense-in-Depth)
-- ==========================================================================
-- Purpose: Idempotent re-application of REVOKE EXECUTE on all SECURITY
-- DEFINER functions. This migration is safe to re-run and serves as an
-- explicit, auditable security gate separate from the initial schema.
--
-- Threat model:
--   PostgREST exposes all public-schema functions via /rpc/<name>.
--   SECURITY DEFINER functions bypass RLS by design.
--   Without explicit REVOKE, the `anon` and `authenticated` roles
--   (used by Supabase client SDKs) can call these functions directly,
--   bypassing the Edge Function authorization layer entirely.
--
-- Mitigation:
--   1. REVOKE EXECUTE from public, anon, authenticated on every RPC.
--   2. GRANT EXECUTE exclusively to service_role (used by Edge Functions).
--   3. ALTER DEFAULT PRIVILEGES to prevent future functions from being
--      auto-granted to public/anon/authenticated.
-- ==========================================================================

-- 1. consume_pantry_item(uuid, text, boolean)
revoke execute on function public.consume_pantry_item(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.consume_pantry_item(uuid, text, boolean)
  to service_role;

-- 2. merge_or_create_item(uuid, text, text, date, int, bigint)
revoke execute on function public.merge_or_create_item(uuid, text, text, date, int, bigint)
  from public, anon, authenticated;
grant execute on function public.merge_or_create_item(uuid, text, text, date, int, bigint)
  to service_role;

-- 3. register_user_with_limit(bigint, text, text, text, text)
revoke execute on function public.register_user_with_limit(bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_user_with_limit(bigint, text, text, text, text)
  to service_role;

-- 4. join_pantry_via_invite(text, bigint)
revoke execute on function public.join_pantry_via_invite(text, bigint)
  from public, anon, authenticated;
grant execute on function public.join_pantry_via_invite(text, bigint)
  to service_role;

-- 5. create_pantry_with_owner(text, bigint)
revoke execute on function public.create_pantry_with_owner(text, bigint)
  from public, anon, authenticated;
grant execute on function public.create_pantry_with_owner(text, bigint)
  to service_role;

-- 6. Belt-and-suspenders: revoke default execute on future functions
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
