/**
 * Supabase Edge Function: send-reminders
 * Invoked by external cron / pg_cron hourly.
 * Protected by CRON_SECRET.
 */

// @ts-expect-error Deno import
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleSendReminders } from './handler.ts';
import type {
  SendRemindersDb,
  SendRemindersDependencies,
  EligibleUser,
  PantryWithActiveItems,
} from './types.ts';
import type { SupportedLanguage } from '../../../shared/i18n.ts';

// @ts-expect-error Deno global
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// @ts-expect-error Deno global
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// @ts-expect-error Deno global
const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
// @ts-expect-error Deno global
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const db: SendRemindersDb = {
  async getEligibleUsers(): Promise<EligibleUser[]> {
    const { data, error } = await supabase
      .from('users')
      .select('telegram_id, first_name, language_code, timezone, reminder_hour, reminders_enabled, can_write_pm')
      .eq('reminders_enabled', true)
      .eq('can_write_pm', true);

    if (error || !data) {
      console.error('Error fetching eligible users:', error);
      return [];
    }

    return data.map((u: any) => ({
      telegram_id: u.telegram_id,
      first_name: u.first_name || '',
      language_code: (u.language_code || 'ru') as SupportedLanguage,
      timezone: u.timezone || 'Europe/Moscow',
      reminder_hour: u.reminder_hour ?? 9,
      reminders_enabled: u.reminders_enabled ?? true,
      can_write_pm: u.can_write_pm ?? false,
    }));
  },

  async getUserPantriesWithActiveItems(userId: number): Promise<PantryWithActiveItems[]> {
    // 1. Get pantries for user
    const { data: memberRows, error: memberErr } = await supabase
      .from('pantry_members')
      .select('pantry_id, pantries(id, name)')
      .eq('user_id', userId);

    if (memberErr || !memberRows) {
      console.error('Error fetching user pantries:', memberErr);
      return [];
    }

    const results: PantryWithActiveItems[] = [];

    for (const row of memberRows) {
      if (!row.pantries) continue;
      const pantryId = row.pantries.id;
      const pantryName = row.pantries.name;

      const { data: items, error: itemsErr } = await supabase
        .from('items')
        .select('id, name, quantity, expiration_date, status')
        .eq('pantry_id', pantryId)
        .eq('status', 'active');

      if (itemsErr) {
        console.error(`Error fetching active items for pantry ${pantryId}:`, itemsErr);
        continue;
      }

      results.push({
        pantryId,
        pantryName,
        items: (items || []).map((it: any) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          expiration_date: it.expiration_date,
          status: 'active',
        })),
      });
    }

    return results;
  },

  async getExistingReminderLogs(userId: number, itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();

    const { data, error } = await supabase
      .from('reminder_log')
      .select('item_id, stage')
      .eq('user_id', userId)
      .in('item_id', itemIds);

    if (error || !data) {
      console.error('Error fetching reminder logs:', error);
      return new Set();
    }

    const set = new Set<string>();
    for (const row of data) {
      set.add(`${row.item_id}:${row.stage}`);
    }
    return set;
  },

  async recordReminderLogs(records: Array<{ user_id: number; item_id: string; stage: number }>): Promise<boolean> {
    if (records.length === 0) return true;

    const { error } = await supabase
      .from('reminder_log')
      .insert(records);

    if (error) {
      console.warn('Reminder logs already claimed or conflict:', error.message);
      return false;
    }
    return true;
  },

  async updateCanWritePm(userId: number, canWrite: boolean): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ can_write_pm: canWrite })
      .eq('telegram_id', userId);

    if (error) {
      console.warn('Failed to update can_write_pm in send-reminders:', error);
    }
  },

  async deleteReminderLogs(records: Array<{ user_id: number; item_id: string; stage: number }>): Promise<void> {
    for (const r of records) {
      await supabase
        .from('reminder_log')
        .delete()
        .eq('user_id', r.user_id)
        .eq('item_id', r.item_id)
        .eq('stage', r.stage);
    }
  },
};

const deps: SendRemindersDependencies = {
  db,
  botToken: BOT_TOKEN,
  cronSecret: CRON_SECRET,
};

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  return await handleSendReminders(req, deps);
});
