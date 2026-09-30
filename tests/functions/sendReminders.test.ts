import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSendReminders } from '../../supabase/functions/send-reminders/handler.ts';
import type {
  SendRemindersDb,
  SendRemindersDependencies,
  EligibleUser,
  PantryWithActiveItems,
} from '../../supabase/functions/send-reminders/types.ts';

const TEST_CRON_SECRET = 'super_secret_cron_token_12345';
const TEST_BOT_TOKEN = '123456789:ABC_telegram_bot_token';

describe('Stage 6: send-reminders Cron Worker', () => {
  let mockUsers: EligibleUser[];
  let mockPantriesByUser: Map<number, PantryWithActiveItems[]>;
  let mockReminderLogs: Set<string>; // `${user_id}:${item_id}:${stage}`
  let sentTelegrams: Array<{ chat_id: number; text: string; parse_mode: string }>;
  let mockFetch: any;
  let deps: SendRemindersDependencies;
  const fixedNow = new Date('2026-10-01T06:00:00Z'); // 09:00:00 MSK (Europe/Moscow)

  beforeEach(() => {
    mockUsers = [];
    mockPantriesByUser = new Map();
    mockReminderLogs = new Set();
    sentTelegrams = [];

    mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string || '{}');
      sentTelegrams.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
        text: async () => JSON.stringify({ ok: true }),
      };
    });

    const mockDb: SendRemindersDb = {
      async getEligibleUsers() {
        return mockUsers;
      },
      async getUserPantriesWithActiveItems(userId: number) {
        return mockPantriesByUser.get(userId) || [];
      },
      async getExistingReminderLogs(userId: number, itemIds: string[]) {
        const found = new Set<string>();
        for (const id of itemIds) {
          for (const s of [1, 2, 3]) {
            if (mockReminderLogs.has(`${userId}:${id}:${s}`)) {
              found.add(`${id}:${s}`);
            }
          }
        }
        return found;
      },
      async recordReminderLogs(records) {
        for (const r of records) {
          mockReminderLogs.add(`${r.user_id}:${r.item_id}:${r.stage}`);
        }
        return true;
      },
      async updateCanWritePm(userId: number, canWrite: boolean) {
        const u = mockUsers.find((user) => user.telegram_id === userId);
        if (u) {
          u.can_write_pm = canWrite;
        }
      },
    };

    deps = {
      db: mockDb,
      botToken: TEST_BOT_TOKEN,
      cronSecret: TEST_CRON_SECRET,
      now: () => fixedNow,
      fetch: mockFetch,
    };
  });

  describe('Authentication & Security', () => {
    it('rejects calls without or with invalid cron secret with 401', async () => {
      const reqMissing = new Request('https://example.com/send-reminders', {
        method: 'POST',
      });
      const resMissing = await handleSendReminders(reqMissing, deps);
      expect(resMissing.status).toBe(401);

      const reqInvalid = new Request('https://example.com/send-reminders', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong_secret' },
      });
      const resInvalid = await handleSendReminders(reqInvalid, deps);
      expect(resInvalid.status).toBe(401);
    });

    it('strictly accepts authorization via Bearer header and rejects query-string secrets to prevent URL logging leaks', async () => {
      const reqBearer = new Request('https://example.com/send-reminders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` },
      });
      const resBearer = await handleSendReminders(reqBearer, deps);
      expect(resBearer.status).toBe(200);

      // Rejects query parameter secrets to prevent URL exposure
      const reqQuery = new Request(`https://example.com/send-reminders?secret=${TEST_CRON_SECRET}`, {
        method: 'POST',
      });
      const resQuery = await handleSendReminders(reqQuery, deps);
      expect(resQuery.status).toBe(401);
    });
  });

  describe('Reminders Processing & Notification Delivery', () => {
    it('processes only users whose local hour matches reminder_hour and sends 1 message per pantry', async () => {
      // fixedNow is 06:00:00 UTC -> 09:00:00 Moscow (UTC+3)
      mockUsers = [
        {
          telegram_id: 100,
          first_name: 'Ivan',
          language_code: 'ru',
          timezone: 'Europe/Moscow',
          reminder_hour: 9, // MATCH!
          reminders_enabled: true,
          can_write_pm: true,
        },
        {
          telegram_id: 200,
          first_name: 'John',
          language_code: 'en',
          timezone: 'America/New_York', // In NY, 06:00 UTC is 02:00 EDT -> does NOT match 9
          reminder_hour: 9,
          reminders_enabled: true,
          can_write_pm: true,
        },
      ];

      // Ivan's local date is 2026-10-01
      mockPantriesByUser.set(100, [
        {
          pantryId: 'p-1',
          pantryName: 'Основная кухня',
          items: [
            // Stage 2: today (2026-10-01)
            { id: 'item-1', name: 'Молоко', quantity: 2, expiration_date: '2026-10-01', status: 'active' },
            // Stage 1: 1 day left (2026-10-02)
            { id: 'item-2', name: 'Сыр', quantity: 1, expiration_date: '2026-10-02', status: 'active' },
            // Not due: 10 days left (2026-10-11)
            { id: 'item-3', name: 'Крупа', quantity: 5, expiration_date: '2026-10-11', status: 'active' },
          ],
        },
      ]);

      const req = new Request('https://example.com/send-reminders', {
        headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` },
      });

      const res = await handleSendReminders(req, deps);
      expect(res.status).toBe(200);
      const resJson = await res.json();
      expect(resJson.dueUsersCount).toBe(1);
      expect(resJson.messagesSent).toBe(1);
      expect(resJson.loggedReminders).toBe(2);

      // Verify Telegram API call
      expect(sentTelegrams.length).toBe(1);
      expect(sentTelegrams[0].chat_id).toBe(100);
      expect(sentTelegrams[0].parse_mode).toBe('HTML');
      expect(sentTelegrams[0].text).toContain('Основная кухня');
      expect(sentTelegrams[0].text).toContain('Молоко');
      expect(sentTelegrams[0].text).toContain('Сыр');
      expect(sentTelegrams[0].text).not.toContain('Крупа');

      // Verify reminder_log entries recorded
      expect(mockReminderLogs.has('100:item-1:2')).toBe(true);
      expect(mockReminderLogs.has('100:item-2:1')).toBe(true);
      expect(mockReminderLogs.has('100:item-3:1')).toBe(false);
    });

    it('deduplicates: does not send reminder if stage is already in reminder_log', async () => {
      mockUsers = [
        {
          telegram_id: 100,
          first_name: 'Ivan',
          language_code: 'ru',
          timezone: 'Europe/Moscow',
          reminder_hour: 9,
          reminders_enabled: true,
          can_write_pm: true,
        },
      ];

      // Item 1 has already been reminded for stage 2
      mockReminderLogs.add('100:item-1:2');

      mockPantriesByUser.set(100, [
        {
          pantryId: 'p-1',
          pantryName: 'Кухня',
          items: [
            { id: 'item-1', name: 'Молоко', quantity: 2, expiration_date: '2026-10-01', status: 'active' },
          ],
        },
      ]);

      const req = new Request('https://example.com/send-reminders', {
        headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` },
      });

      const res = await handleSendReminders(req, deps);
      expect(res.status).toBe(200);
      const resJson = await res.json();
      expect(resJson.messagesSent).toBe(0);
      expect(sentTelegrams.length).toBe(0);
    });

    it('handles 403 Forbidden from Telegram by revoking can_write_pm', async () => {
      mockUsers = [
        {
          telegram_id: 300,
          first_name: 'Blocked User',
          language_code: 'ru',
          timezone: 'Europe/Moscow',
          reminder_hour: 9,
          reminders_enabled: true,
          can_write_pm: true,
        },
      ];

      mockPantriesByUser.set(300, [
        {
          pantryId: 'p-1',
          pantryName: 'Склад 1',
          items: [{ id: 'it-1', name: 'Хлеб', quantity: 1, expiration_date: '2026-10-01', status: 'active' }],
        },
        {
          pantryId: 'p-2',
          pantryName: 'Склад 2',
          items: [{ id: 'it-2', name: 'Масло', quantity: 1, expiration_date: '2026-10-01', status: 'active' }],
        },
      ]);

      // Telegram mock returns 403 (bot was blocked by user)
      mockFetch = vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }),
        text: async () => 'Forbidden: bot was blocked by the user',
      }));
      deps.fetch = mockFetch;

      const req = new Request('https://example.com/send-reminders', {
        headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` },
      });

      const res = await handleSendReminders(req, deps);
      expect(res.status).toBe(200);
      const resJson = await res.json();
      expect(resJson.messagesSent).toBe(0);
      expect(resJson.loggedReminders).toBe(0);

      // Verify can_write_pm was set to false
      expect(mockUsers[0].can_write_pm).toBe(false);

      // And it should have aborted further messages for that user (only 1 fetch call, not 2)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
