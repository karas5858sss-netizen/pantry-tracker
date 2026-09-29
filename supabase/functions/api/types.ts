/**
 * Types and interfaces for the backend API Edge Functions.
 * Relative imports use .ts extension for Deno and Vitest cross-compatibility.
 */


export interface UserRecord {
  telegram_id: number;
  first_name: string;
  username: string | null;
  language_code: string;
  timezone: string;
  reminder_hour: number;
  reminders_enabled: boolean;
  can_write_pm: boolean;
  created_at: string;
}

export interface UpsertUserData {
  telegram_id: number;
  first_name: string;
  username?: string | null;
  language_code?: string;
  timezone?: string;
}

export interface PantryRecord {
  id: string;
  name: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface DatabaseClient {
  isUserAllowed: (telegramId: number) => Promise<boolean>;
  getUsersCount: () => Promise<number>;
  getUser: (telegramId: number) => Promise<UserRecord | null>;
  upsertUser: (userData: UpsertUserData) => Promise<UserRecord>;
  getUserPantries: (telegramId: number) => Promise<PantryRecord[]>;
  createPantry: (name: string, ownerTelegramId: number) => Promise<PantryRecord>;
}

export interface ApiDependencies {
  db: DatabaseClient;
  botToken: string;
  now?: () => Date;
}

export interface SessionResponse {
  user: UserRecord;
  pantries: PantryRecord[];
  currentPantry: PantryRecord;
}
