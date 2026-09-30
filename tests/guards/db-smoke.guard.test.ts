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

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://hvyotkemriptfbeeczlu.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_EXHwpQCJMgo6hefwKE5wkA_sNFJrz6i';

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
  let isReachable = false;

  beforeAll(async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      isReachable = res.status < 500;
    } catch {
      isReachable = false;
    }
  });

  for (const { name, insertPayload } of TABLES) {
    describe(`Table: "${name}"`, () => {
      it(`blocks SELECT query with anon key (returns 0 rows / empty array)`, async () => {
        if (!isReachable) {
          console.warn(`[db-smoke] Supabase endpoint not reachable at ${SUPABASE_URL}. Skipping live query.`);
          return;
        }

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
        if (!isReachable) return;

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
