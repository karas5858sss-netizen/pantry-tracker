import { describe, it, expect, beforeAll } from 'vitest';

/**
 * DB Smoke-Test: Row-Level Security (RLS) enforcement verification with public anon key.
 *
 * Verifies that:
 * 1. Direct SELECT on any table using anon key returns zero rows (no data leakage).
 * 2. Direct INSERT using valid schema columns is rejected by PostgreSQL RLS (error 42501).
 * 3. All public database access must exclusively flow through backend Edge Functions
 *    with service role privileges.
 */

// These must be provided via environment variables — no production fallback.
// In CI the `db-smoke` job sets them from `supabase status -o json`.
// Locally: run `supabase start` first, then set SUPABASE_URL and SUPABASE_ANON_KEY.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[db-smoke] SUPABASE_URL and SUPABASE_ANON_KEY must be set.\n' +
    'Run `supabase start` first, then export SUPABASE_URL and SUPABASE_ANON_KEY from `supabase status`.\n' +
    'This test must NOT run via `npm test` — use `npm run test:smoke` instead.'
  );
}

interface TableDefinition {
  name: string;
  insertPayload: Record<string, unknown>;
}

const TABLES: TableDefinition[] = [
  {
    name: 'users',
    insertPayload: { telegram_id: 999999999, first_name: 'Hacker' },
  },
  {
    name: 'allowed_users',
    insertPayload: { telegram_id: 999999999, note: 'Unauthorized' },
  },
  {
    name: 'pantries',
    insertPayload: { name: 'Unauthorized Pantry' },
  },
  {
    name: 'pantry_members',
    insertPayload: {
      pantry_id: '00000000-0000-0000-0000-000000000000',
      user_id: 999999999,
      role: 'member',
    },
  },
  {
    name: 'pantry_invites',
    insertPayload: {
      code: 'unauthorized_invite_code_123',
      pantry_id: '00000000-0000-0000-0000-000000000000',
      expires_at: '2099-01-01T00:00:00Z',
    },
  },
  {
    name: 'products',
    insertPayload: { barcode: '9999999999999', name: 'Unauthorized Product' },
  },
  {
    name: 'items',
    insertPayload: {
      pantry_id: '00000000-0000-0000-0000-000000000000',
      barcode: '9999999999999',
      name: 'Unauthorized Item',
    },
  },
  {
    name: 'reminder_log',
    insertPayload: {
      user_id: 999999999,
      item_id: '00000000-0000-0000-0000-000000000000',
      stage: 1,
    },
  },
];

describe('Database Smoke-Test: RLS Enforcement with Public Anon Key', () => {
  // Verify the endpoint is truly reachable before running tests.
  // Unlike unit tests, this one must fail loudly if DB is unreachable.
  beforeAll(async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (res.status >= 500) {
      throw new Error(`[db-smoke] Supabase at ${SUPABASE_URL} returned ${res.status}. Is it running?`);
    }
  });

  for (const { name, insertPayload } of TABLES) {
    describe(`Table: "${name}"`, () => {
      it(`blocks SELECT query with anon key (returns 0 rows / empty array)`, async () => {

        const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*`, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data).toHaveLength(0); // Zero records leaked through anon key
      });

      it(`rejects direct INSERT with anon key via RLS violation (42501)`, async () => {

        const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(insertPayload),
        });

        // Must fail with 401/403/400 (PGRST / RLS violation)
        expect(res.status).toBeGreaterThanOrEqual(400);

        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const isRlsBlocked =
          body.code === '42501' ||
          res.status === 401 ||
          res.status === 403 ||
          (typeof body.message === 'string' && body.message.toLowerCase().includes('violates row-level security'));

        expect(
          isRlsBlocked,
          `Expected table "${name}" to reject direct insert via RLS, received: ${JSON.stringify(body)}`
        ).toBe(true);
      });
    });
  }
});

/**
 * RPC Security Guard: SECURITY DEFINER functions must NOT be callable via anon key.
 *
 * These functions are restricted to service_role only via:
 *   REVOKE EXECUTE FROM public, anon, authenticated;
 *   GRANT EXECUTE TO service_role;
 *
 * PostgREST should return 401 (no permission), 403, or 404 (function not exposed
 * in the PostgREST schema cache after REVOKE).
 */
interface RpcTestCase {
  name: string;
  params: Record<string, unknown>;
}

const SECURITY_DEFINER_RPCS: RpcTestCase[] = [
  {
    name: 'consume_pantry_item',
    params: {
      p_item_id: '00000000-0000-0000-0000-000000000000',
      p_action: 'consumed',
      p_all: false,
    },
  },
  {
    name: 'merge_or_create_item',
    params: {
      p_pantry_id: '00000000-0000-0000-0000-000000000000',
      p_barcode: '0000000000000',
      p_name: 'Hacker Item',
      p_expiration_date: '2099-01-01',
      p_quantity: 1,
      p_created_by: 999999999,
    },
  },
  {
    name: 'register_user_with_limit',
    params: {
      p_telegram_id: 999999999,
      p_first_name: 'Hacker',
      p_username: 'hacker',
      p_language_code: 'en',
      p_timezone: 'UTC',
    },
  },
  {
    name: 'join_pantry_via_invite',
    params: {
      p_code: 'fake_invite_code_1234567',
      p_user_id: 999999999,
    },
  },
  {
    name: 'create_pantry_with_owner',
    params: {
      p_name: 'Hacker Pantry',
      p_owner_id: 999999999,
    },
  },
];

describe('RPC Security Guard: SECURITY DEFINER functions blocked for anon', () => {
  for (const { name, params } of SECURITY_DEFINER_RPCS) {
    it(`rejects anon call to RPC "${name}" (permission denied)`, async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(params),
      });

      // After REVOKE EXECUTE, PostgREST returns one of:
      //   401 - permission denied for function
      //   403 - forbidden
      //   404 - function not found in schema cache (revoked functions disappear from PostgREST)
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      const isBlocked =
        res.status === 401 ||
        res.status === 403 ||
        res.status === 404 ||
        body.code === '42501' ||
        (typeof body.message === 'string' &&
          (body.message.includes('permission denied') ||
           body.message.includes('Could not find')));

      expect(
        isBlocked,
        `Expected RPC "${name}" to be blocked for anon key, ` +
        `but got status ${res.status}: ${JSON.stringify(body)}`
      ).toBe(true);
    });
  }
});
