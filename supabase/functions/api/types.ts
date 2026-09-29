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

export interface InviteRecord {
  code: string;
  pantry_id: string;
  created_by: number;
  expires_at: string;
  max_uses: number;
  uses: number;
}

export interface PantryMemberRecord {
  pantry_id: string;
  user_id: number;
  role: 'owner' | 'member';
  first_name: string;
  username: string | null;
  joined_at: string;
}

export interface DatabaseClient {
  isUserAllowed: (telegramId: number) => Promise<boolean>;
  getUsersCount: () => Promise<number>;
  getUser: (telegramId: number) => Promise<UserRecord | null>;
  upsertUser: (userData: UpsertUserData) => Promise<UserRecord>;
  getUserPantries: (telegramId: number) => Promise<PantryRecord[]>;
  createPantry: (name: string, ownerTelegramId: number) => Promise<PantryRecord>;

  // Stage 2: Sharing and pantries management
  getUserPantryMembership: (pantryId: string, userId: number) => Promise<'owner' | 'member' | null>;
  getPantryMembers: (pantryId: string) => Promise<PantryMemberRecord[]>;
  createPantryInvite: (
    pantryId: string,
    createdBy: number,
    code: string,
    expiresAt: string,
    maxUses: number
  ) => Promise<InviteRecord>;
  getInvite: (code: string) => Promise<InviteRecord | null>;
  joinPantryViaInvite: (
    code: string,
    userId: number
  ) => Promise<{ pantry: PantryRecord; alreadyMember: boolean }>;
  leavePantry: (pantryId: string, userId: number) => Promise<void>;
  deletePantry: (pantryId: string, ownerId: number) => Promise<void>;
  removePantryMember: (pantryId: string, ownerId: number, targetUserId: number) => Promise<void>;
  updateCanWritePm: (userId: number, canWrite: boolean) => Promise<void>;

  // Stage 3: Products resolution and catalog
  getProduct: (barcode: string) => Promise<ProductRecord | null>;
  upsertProduct: (barcode: string, name: string, source: 'manual' | 'off') => Promise<ProductRecord>;
}

export interface ProductRecord {
  barcode: string;
  name: string;
  source: 'manual' | 'off';
  updated_at: string;
}

export interface ApiDependencies {
  db: DatabaseClient;
  botToken: string;
  now?: () => Date;
  botUsername?: string;
  appShortName?: string;
  fetchOffProduct?: (barcode: string, lang: 'ru' | 'es' | 'en') => Promise<string | null>;
}

export interface SessionResponse {
  user: UserRecord;
  pantries: PantryRecord[];
  currentPantry: PantryRecord;
}
