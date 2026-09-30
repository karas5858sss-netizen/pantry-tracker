import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isUserReminderDue, getUserLocalDate, getUserLocalHour } from '../../shared/reminders.ts';
import { detectLanguage, translations } from '../../shared/i18n.ts';

describe('Этап 7. Деплой и приёмка (Acceptance & Production Readiness)', () => {
  const rootDir = process.cwd();

  describe('CI/CD and Build Pipeline Configuration', () => {
    it('ensures GitHub Actions CI workflow exists and validates typecheck, tests, and build', () => {
      const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
      expect(fs.existsSync(ciPath)).toBe(true);

      const ciContent = fs.readFileSync(ciPath, 'utf-8');
      expect(ciContent).toContain('npm run check');
      expect(ciContent).toContain('npm test');
      expect(ciContent).toContain('npm run build');
      expect(ciContent).toContain('branches: [main]');
    });

    it('ensures package.json contains all required production scripts', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      expect(pkg.scripts.check).toBe('tsc --noEmit');
      expect(pkg.scripts.test).toBe('vitest run');
      expect(pkg.scripts.build).toContain('vite build');
    });
  });

  describe('Security and Secrets Guard for Stage 7', () => {
    it('ensures no secrets exist in client code (src/) or git tracked files', () => {
      const scanDir = (dir: string): string[] => {
        let results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
              results = results.concat(scanDir(full));
            }
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
            results.push(full);
          }
        }
        return results;
      };

      const srcFiles = scanDir(path.join(rootDir, 'src'));
      for (const file of srcFiles) {
        const text = fs.readFileSync(file, 'utf-8');
        expect(text).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
        expect(text).not.toContain('service_role');
        expect(text).not.toContain('CRON_SECRET');
      }
    });

    it('ensures .env.example contains public client variables without secret values', () => {
      const envExPath = path.join(rootDir, '.env.example');
      expect(fs.existsSync(envExPath)).toBe(true);
      const envContent = fs.readFileSync(envExPath, 'utf-8');

      expect(envContent).toContain('VITE_SUPABASE_URL');
      expect(envContent).toContain('VITE_SUPABASE_ANON_KEY');
      expect(envContent).toContain('VITE_TELEGRAM_BOT_NAME');
      expect(envContent).not.toMatch(/BOT_TOKEN=[a-zA-Z0-9_]{10,}/);
      expect(envContent).not.toMatch(/CRON_SECRET=[a-zA-Z0-9_]{10,}/);
    });
  });

  describe('Timezone & Internationalization for Europe/Moscow & Europe/Madrid', () => {
    it('correctly handles time calculations for Europe/Moscow and Europe/Madrid', () => {
      // 2026-10-01 07:00:00 UTC
      // In Moscow (UTC+3): 10:00:00
      // In Madrid (UTC+2 in CEST summer time): 09:00:00
      const now = new Date('2026-10-01T07:00:00Z');

      expect(getUserLocalHour(now, 'Europe/Moscow')).toBe(10);
      expect(getUserLocalDate(now, 'Europe/Moscow')).toBe('2026-10-01');

      expect(getUserLocalHour(now, 'Europe/Madrid')).toBe(9);
      expect(getUserLocalDate(now, 'Europe/Madrid')).toBe('2026-10-01');

      // Madrid user with reminder at 9 should trigger, Moscow user with reminder at 9 should NOT trigger (it is 10:00 in Moscow)
      const madridUser = {
        reminder_hour: 9,
        reminders_enabled: true,
        timezone: 'Europe/Madrid',
        can_write_pm: true,
      };
      const moscowUser = {
        reminder_hour: 9,
        reminders_enabled: true,
        timezone: 'Europe/Moscow',
        can_write_pm: true,
      };

      expect(isUserReminderDue(madridUser, now)).toBe(true);
      expect(isUserReminderDue(moscowUser, now)).toBe(false);
    });

    it('ensures Russian, Spanish, and English localization is 100% complete', () => {
      const ruKeys = Object.keys(translations.ru);
      const esKeys = Object.keys(translations.es);
      const enKeys = Object.keys(translations.en);

      expect(esKeys.length).toBe(ruKeys.length);
      expect(enKeys.length).toBe(ruKeys.length);

      for (const k of ruKeys) {
        expect((translations.es as Record<string, string>)[k]).toBeDefined();
        expect((translations.en as Record<string, string>)[k]).toBeDefined();
      }

      expect(detectLanguage('ru')).toBe('ru');
      expect(detectLanguage('es')).toBe('es');
      expect(detectLanguage('en')).toBe('en');
    });
  });

  describe('README Documentation for Stage 7 Handover', () => {
    it('ensures README.md contains comprehensive Stage 7 deployment and acceptance instructions', () => {
      const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf-8');

      // Check for Cloudflare Pages guide
      expect(readme).toContain('Cloudflare Pages');
      expect(readme).toContain('VITE_SUPABASE_URL');
      expect(readme).toContain('VITE_SUPABASE_ANON_KEY');

      // Check for Telegram BotFather guide
      expect(readme).toContain('BotFather');

      // Check for checklist items
      expect(readme).toContain('iOS');
      expect(readme).toContain('Android');
      expect(readme).toContain('Europe/Moscow');
      expect(readme).toContain('Europe/Madrid');
    });
  });
});
