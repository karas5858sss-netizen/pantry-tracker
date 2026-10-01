import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('PostgreSQL RPC Security Hardening Guard', () => {
  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
  const hardeningMigrationFile = '20260930_rpc_security_hardening.sql';
  const initMigrationFile = '20260929_init.sql';

  const hardeningPath = path.join(migrationsDir, hardeningMigrationFile);
  const initPath = path.join(migrationsDir, initMigrationFile);

  const REQUIRED_RPCS = [
    'consume_pantry_item',
    'merge_or_create_item',
    'register_user_with_limit',
    'join_pantry_via_invite',
    'create_pantry_with_owner',
  ];

  it('ensures separate security hardening migration exists (preserving initial migration history)', () => {
    expect(fs.existsSync(hardeningPath), `${hardeningMigrationFile} must exist`).toBe(true);
    expect(fs.existsSync(initPath), `${initMigrationFile} must exist`).toBe(true);
  });

  it('ensures each SECURITY DEFINER function sets search_path = \'\' to prevent hijacking', () => {
    const content = fs.readFileSync(hardeningPath, 'utf-8');

    for (const rpc of REQUIRED_RPCS) {
      // Regex matches: create or replace function public.<rpc> ... security definer ... set search_path = ''
      const funcRegex = new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
        'i'
      );
      expect(
        funcRegex.test(content),
        `Function "${rpc}" in ${hardeningMigrationFile} must have SECURITY DEFINER and SET search_path = ''`
      ).toBe(true);
    }
  });

  it('ensures all database tables inside function bodies in hardening migration are qualified with public schema', () => {
    const content = fs.readFileSync(hardeningPath, 'utf-8');

    const tables = [
      'users',
      'allowed_users',
      'pantries',
      'pantry_members',
      'pantry_invites',
      'products',
      'items',
      'reminder_log',
    ];

    for (const table of tables) {
      // Any FROM, INTO, UPDATE, or %rowtype references to table must be schema-qualified with public.
      // E.g. `from public.items`, `update public.items`, `insert into public.items`, `public.items%rowtype`
      const bareFrom = new RegExp(`\\bfrom\\s+${table}\\b(?!\\.)`, 'i');
      const bareInto = new RegExp(`\\binto\\s+${table}\\b(?!\\.)`, 'i');
      const bareUpdate = new RegExp(`\\bupdate\\s+${table}\\b(?!\\.)`, 'i');
      const bareRowtype = new RegExp(`(?<!public\\.)${table}%rowtype`, 'i');

      expect(
        bareFrom.test(content),
        `Unqualified "from ${table}" found in ${hardeningMigrationFile}. Must be "from public.${table}".`
      ).toBe(false);

      expect(
        bareInto.test(content),
        `Unqualified "into ${table}" found in ${hardeningMigrationFile}. Must be "into public.${table}".`
      ).toBe(false);

      expect(
        bareUpdate.test(content),
        `Unqualified "update ${table}" found in ${hardeningMigrationFile}. Must be "update public.${table}".`
      ).toBe(false);

      expect(
        bareRowtype.test(content),
        `Unqualified "${table}%rowtype" found in ${hardeningMigrationFile}. Must be "public.${table}%rowtype".`
      ).toBe(false);
    }
  });

  it('ensures EXECUTE is revoked from public, anon, and authenticated for all 5 RPCs', () => {
    const content = fs.readFileSync(hardeningPath, 'utf-8');

    for (const rpc of REQUIRED_RPCS) {
      const revokeRegex = new RegExp(
        `revoke\\s+execute\\s+on\\s+function\\s+public\\.${rpc}[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated`,
        'i'
      );
      expect(
        revokeRegex.test(content),
        `Expected REVOKE EXECUTE ON FUNCTION public.${rpc} FROM public, anon, authenticated in ${hardeningMigrationFile}`
      ).toBe(true);
    }
  });

  it('ensures EXECUTE is granted exclusively to service_role for all 5 RPCs', () => {
    const content = fs.readFileSync(hardeningPath, 'utf-8');

    for (const rpc of REQUIRED_RPCS) {
      const grantRegex = new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}[\\s\\S]*?to\\s+service_role`,
        'i'
      );
      expect(
        grantRegex.test(content),
        `Expected GRANT EXECUTE ON FUNCTION public.${rpc} TO service_role in ${hardeningMigrationFile}`
      ).toBe(true);
    }
  });

  it('ensures ALTER DEFAULT PRIVILEGES revokes execute from public, anon, authenticated', () => {
    const content = fs.readFileSync(hardeningPath, 'utf-8');
    const defaultPrivRegex = /alter\s+default\s+privileges\s+in\s+schema\s+public\s+revoke\s+execute\s+on\s+functions\s+from\s+public,\s*anon,\s*authenticated/i;
    expect(
      defaultPrivRegex.test(content),
      `Expected ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS in ${hardeningMigrationFile}`
    ).toBe(true);
  });
});
