import { describe, it, expect } from 'vitest';
import {
  getUserLocalDate,
  getUserLocalHour,
  calculateDaysRemaining,
  categorizeReminderStage,
  isUserReminderDue,
  escapeHtml,
  formatPantryReminderHtml,
  type ReminderItem,
  type UserReminderProfile,
} from '../../shared/reminders.ts';

describe('Stage 6: Pure Reminders Domain Logic (shared/reminders.ts)', () => {
  describe('getUserLocalDate & getUserLocalHour', () => {
    it('accurately resolves local date across different timezones', () => {
      // 2026-10-01 22:30:00 UTC
      const now = new Date('2026-10-01T22:30:00Z');

      // In UTC, date is 2026-10-01, hour is 22
      expect(getUserLocalDate(now, 'UTC')).toBe('2026-10-01');
      expect(getUserLocalHour(now, 'UTC')).toBe(22);

      // In Europe/Moscow (UTC+3), time is 2026-10-02 01:30:00 MSK (next day!)
      expect(getUserLocalDate(now, 'Europe/Moscow')).toBe('2026-10-02');
      expect(getUserLocalHour(now, 'Europe/Moscow')).toBe(1);

      // In America/New_York (UTC-4 in daylight saving time), time is 2026-10-01 18:30:00 EDT
      expect(getUserLocalDate(now, 'America/New_York')).toBe('2026-10-01');
      expect(getUserLocalHour(now, 'America/New_York')).toBe(18);

      // In Asia/Tokyo (UTC+9), time is 2026-10-02 07:30:00 JST
      expect(getUserLocalDate(now, 'Asia/Tokyo')).toBe('2026-10-02');
      expect(getUserLocalHour(now, 'Asia/Tokyo')).toBe(7);
    });

    it('falls back to Europe/Moscow gracefully on invalid timezone strings', () => {
      const now = new Date('2026-10-01T12:00:00Z');
      const moscowDate = getUserLocalDate(now, 'Europe/Moscow');
      const fallbackDate = getUserLocalDate(now, 'Invalid/Timezone_Name');
      expect(fallbackDate).toBe(moscowDate);

      const moscowHour = getUserLocalHour(now, 'Europe/Moscow');
      const fallbackHour = getUserLocalHour(now, 'Invalid/Timezone_Name');
      expect(fallbackHour).toBe(moscowHour);
    });
  });

  describe('calculateDaysRemaining', () => {
    it('calculates calendar difference accurately across months and leap years', () => {
      expect(calculateDaysRemaining('2026-10-01', '2026-10-01')).toBe(0);
      expect(calculateDaysRemaining('2026-10-02', '2026-10-01')).toBe(1);
      expect(calculateDaysRemaining('2026-10-03', '2026-10-01')).toBe(2);
      expect(calculateDaysRemaining('2026-09-30', '2026-10-01')).toBe(-1);
      expect(calculateDaysRemaining('2026-09-24', '2026-10-01')).toBe(-7);

      // Cross-month transition
      expect(calculateDaysRemaining('2026-11-01', '2026-10-31')).toBe(1);
      expect(calculateDaysRemaining('2026-10-31', '2026-11-01')).toBe(-1);

      // End of year transition
      expect(calculateDaysRemaining('2027-01-01', '2026-12-31')).toBe(1);
    });
  });

  describe('categorizeReminderStage', () => {
    it('categorizes stages according to specification', () => {
      // Stage 1: 1 or 2 days left
      expect(categorizeReminderStage(1)).toBe(1);
      expect(categorizeReminderStage(2)).toBe(1);

      // Stage 2: expires today (0 days)
      expect(categorizeReminderStage(0)).toBe(2);

      // Stage 3: expired within last 7 days (-1 to -7)
      expect(categorizeReminderStage(-1)).toBe(3);
      expect(categorizeReminderStage(-4)).toBe(3);
      expect(categorizeReminderStage(-7)).toBe(3);

      // Outside notification window: no reminder
      expect(categorizeReminderStage(3)).toBeNull();
      expect(categorizeReminderStage(10)).toBeNull();
      expect(categorizeReminderStage(-8)).toBeNull();
      expect(categorizeReminderStage(-30)).toBeNull();
    });
  });

  describe('isUserReminderDue', () => {
    const baseUser: UserReminderProfile = {
      reminder_hour: 9,
      reminders_enabled: true,
      timezone: 'Europe/Moscow',
      can_write_pm: true,
    };

    it('returns true when current local hour equals reminder_hour and PM access granted', () => {
      // 06:00:00 UTC = 09:00:00 Moscow (UTC+3)
      const now = new Date('2026-10-01T06:00:00Z');
      expect(isUserReminderDue(baseUser, now)).toBe(true);
    });

    it('returns false when current local hour does not match', () => {
      // 07:00:00 UTC = 10:00:00 Moscow
      const now = new Date('2026-10-01T07:00:00Z');
      expect(isUserReminderDue(baseUser, now)).toBe(false);
    });

    it('returns false when reminders_enabled is false', () => {
      const now = new Date('2026-10-01T06:00:00Z');
      const disabledUser = { ...baseUser, reminders_enabled: false };
      expect(isUserReminderDue(disabledUser, now)).toBe(false);
    });

    it('returns false when can_write_pm is false', () => {
      const now = new Date('2026-10-01T06:00:00Z');
      const blockedUser = { ...baseUser, can_write_pm: false };
      expect(isUserReminderDue(blockedUser, now)).toBe(false);
    });
  });

  describe('escapeHtml', () => {
    it('escapes &, <, >, " characters for Telegram HTML', () => {
      expect(escapeHtml('Milk & Cheese <Bio> "100%"')).toBe('Milk &amp; Cheese &lt;Bio&gt; &quot;100%&quot;');
      expect(escapeHtml('Regular Bread')).toBe('Regular Bread');
    });
  });

  describe('formatPantryReminderHtml', () => {
    const mockItems: ReminderItem[] = [
      {
        id: 'item-1',
        name: 'Йогурт клубничный & ванильный',
        quantity: 2,
        expiration_date: '2026-09-30',
        stage: 3,
        daysRemaining: -1,
      },
      {
        id: 'item-2',
        name: 'Молоко <Простоквашино>',
        quantity: 1,
        expiration_date: '2026-10-01',
        stage: 2,
        daysRemaining: 0,
      },
      {
        id: 'item-3',
        name: 'Творог "Домик в деревне"',
        quantity: 3,
        expiration_date: '2026-10-03',
        stage: 1,
        daysRemaining: 2,
      },
    ];

    it('formats a complete HTML message with escaped titles and grouped sections', () => {
      const html = formatPantryReminderHtml('Дом & Дача', mockItems, 'ru');

      expect(html).toContain('Склад «Дом &amp; Дача»: напоминание о сроках');
      expect(html).toContain('🔴 Просрочено');
      expect(html).toContain('Йогурт клубничный &amp; ванильный');
      expect(html).toContain('⚠️ Истекает сегодня');
      expect(html).toContain('Молоко &lt;Простоквашино&gt;');
      expect(html).toContain('⏳ Скоро истекает (1–2 дня)');
      expect(html).toContain('Творог &quot;Домик в деревне&quot;');
    });

    it('supports Spanish and English translations', () => {
      const htmlEs = formatPantryReminderHtml('Casa', mockItems, 'es');
      expect(htmlEs).toContain('Despensa «Casa»: recordatorio de caducidad');
      expect(htmlEs).toContain('🔴 Caducado');
      expect(htmlEs).toContain('⚠️ Caduca hoy');
      expect(htmlEs).toContain('⏳ Caduca pronto (1–2 días)');

      const htmlEn = formatPantryReminderHtml('Home', mockItems, 'en');
      expect(htmlEn).toContain('Pantry "Home": expiration reminder');
      expect(htmlEn).toContain('🔴 Expired');
      expect(htmlEn).toContain('⚠️ Expires today');
      expect(htmlEn).toContain('⏳ Expiring soon (1–2 days)');
    });

    it('truncates at maxItems and appends overflow note', () => {
      const manyItems: ReminderItem[] = Array.from({ length: 25 }, (_, idx) => ({
        id: `item-${idx}`,
        name: `Товар #${idx + 1}`,
        quantity: 1,
        expiration_date: '2026-10-01',
        stage: 2,
        daysRemaining: 0,
      }));

      const html = formatPantryReminderHtml('Большой склад', manyItems, 'ru', 20);

      expect(html).toContain('Товар #20');
      expect(html).not.toContain('Товар #21');
      expect(html).toContain('... и ещё 5 позиций');
    });

    it('returns empty string when no items are provided', () => {
      expect(formatPantryReminderHtml('Пустой склад', [], 'ru')).toBe('');
    });
  });
});
