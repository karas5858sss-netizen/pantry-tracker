import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('RLS Guard Tests', () => {
  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
  const sqlFiles = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
    : [];

  it('ensures migration files exist', () => {
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it('ensures every created table in migrations has Row Level Security explicitly enabled', () => {
    for (const sqlFile of sqlFiles) {
      const content = fs.readFileSync(path.join(migrationsDir, sqlFile), 'utf-8');

      // Find all table names created via `create table [if not exists] <tableName>`
      const tableMatches = [
        ...content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)/gi),
      ];
      const createdTables = tableMatches.map((m) => m[1].toLowerCase());

      expect(createdTables.length).toBeGreaterThan(0);

      for (const table of createdTables) {
        const rlsRegex = new RegExp(
          `alter\\s+table\\s+(?:only\\s+)?${table}\\s+enable\\s+row\\s+level\\s+security`,
          'i'
        );
        const hasRls = rlsRegex.test(content);
        expect(
          hasRls,
          `Table "${table}" in migration "${sqlFile}" MUST have Row Level Security enabled via "alter table ${table} enable row level security;"`
        ).toBe(true);
      }
    }
  });

  it('ensures no client RLS policies are created (zero policies rule)', () => {
    for (const sqlFile of sqlFiles) {
      const content = fs.readFileSync(path.join(migrationsDir, sqlFile), 'utf-8');
      expect(content).not.toMatch(/create\s+policy/i);
    }
  });

  it('ensures GitHub Actions CI includes a dedicated DB smoke-test job with local Supabase', () => {
    const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
    expect(fs.existsSync(ciPath)).toBe(true);
    const content = fs.readFileSync(ciPath, 'utf-8');
    expect(content).toContain('supabase start');
    expect(content).toContain('test:smoke');
  });
});
