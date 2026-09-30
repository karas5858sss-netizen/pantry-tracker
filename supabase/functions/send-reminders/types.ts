import type { SupportedLanguage } from '../../../shared/i18n.ts';

export interface EligibleUser {
  telegram_id: number;
  first_name: string;
  language_code: SupportedLanguage;
  timezone: string;
  reminder_hour: number;
  reminders_enabled: boolean;
  can_write_pm: boolean;
}

export interface ActiveItemForReminder {
  id: string;
  name: string;
  quantity: number;
  expiration_date: string; // YYYY-MM-DD
  status: 'active';
}

export interface PantryWithActiveItems {
  pantryId: string;
  pantryName: string;
  items: ActiveItemForReminder[];
}

export interface SendRemindersDb {
  getEligibleUsers: () => Promise<EligibleUser[]>;
  getUserPantriesWithActiveItems: (userId: number) => Promise<PantryWithActiveItems[]>;
  getExistingReminderLogs: (userId: number, itemIds: string[]) => Promise<Set<string>>; // returns Set<`${item_id}:${stage}`>
  recordReminderLogs: (records: Array<{ user_id: number; item_id: string; stage: number }>) => Promise<boolean>;
  deleteReminderLogs?: (records: Array<{ user_id: number; item_id: string; stage: number }>) => Promise<void>;
  updateCanWritePm: (userId: number, canWrite: boolean) => Promise<void>;
}

export interface SendRemindersDependencies {
  db: SendRemindersDb;
  botToken: string;
  cronSecret: string;
  now?: () => Date;
  fetch?: typeof fetch;
}

export interface SendRemindersResult {
  success: boolean;
  dueUsersCount: number;
  messagesSent: number;
  loggedReminders: number;
}
