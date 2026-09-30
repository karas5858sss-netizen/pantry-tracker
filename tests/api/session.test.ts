import { describe, it, expect, beforeEach } from 'vitest';
import { handleApiRequest } from '../../supabase/functions/api/handler.ts';
import { createTestInitData, type TelegramUser } from '../../shared/telegramAuth.ts';
import type {
  DatabaseClient,
  ApiDependencies,
  UserRecord,
  PantryRecord,
  UpsertUserData,
  SessionResponse,
  CreateItemData,
  ItemRecord,
  UpdateItemData,
} from '../../supabase/functions/api/types.ts';

const TEST_BOT_TOKEN = '123456789:ABCDEF_mock_bot_token_for_tests';

function createMockDb(): DatabaseClient & {
  allowedUsersSet: Set<number>;
  usersMap: Map<number, UserRecord>;
  pantriesMap: Map<string, { id: string; name: string; created_at: string }>;
  membersList: Array<{ pantry_id: string; user_id: number; role: 'owner' | 'member' }>;
} {
  const allowedUsersSet = new Set<number>();
  const usersMap = new Map<number, UserRecord>();
  const pantriesMap = new Map<string, { id: string; name: string; created_at: string }>();
  const membersList: Array<{ pantry_id: string; user_id: number; role: 'owner' | 'member' }> = [];

  return {
    allowedUsersSet,
    usersMap,
    pantriesMap,
    membersList,

    async isUserAllowed(telegramId: number): Promise<boolean> {
      return allowedUsersSet.has(telegramId);
    },

    async getUsersCount(): Promise<number> {
      return usersMap.size;
    },

    async getUser(telegramId: number): Promise<UserRecord | null> {
      return usersMap.get(telegramId) || null;
    },

    async upsertUser(userData: UpsertUserData): Promise<UserRecord> {
      const existing = usersMap.get(userData.telegram_id);
      const updated: UserRecord = {
        telegram_id: userData.telegram_id,
        first_name: userData.first_name,
        username: userData.username ?? null,
        language_code: userData.language_code ?? 'ru',
        timezone: userData.timezone ?? 'Europe/Moscow',
        reminder_hour: existing?.reminder_hour ?? 9,
        reminders_enabled: existing?.reminders_enabled ?? true,
        can_write_pm: existing?.can_write_pm ?? false,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      usersMap.set(userData.telegram_id, updated);
      return updated;
    },

    async getUserPantries(telegramId: number): Promise<PantryRecord[]> {
      const userMemberships = membersList.filter((m) => m.user_id === telegramId);
      const results: PantryRecord[] = [];

      for (const m of userMemberships) {
        const pantry = pantriesMap.get(m.pantry_id);
        if (pantry) {
          results.push({
            id: pantry.id,
            name: pantry.name,
            role: m.role,
            created_at: pantry.created_at,
          });
        }
      }
      return results;
    },

    async createPantry(name: string, ownerTelegramId: number): Promise<PantryRecord> {
      const id = `pantry-${pantriesMap.size + 1}`;
      const created_at = new Date().toISOString();
      pantriesMap.set(id, { id, name, created_at });
      membersList.push({ pantry_id: id, user_id: ownerTelegramId, role: 'owner' });

      return {
        id,
        name,
        role: 'owner',
        created_at,
      };
    },

    async getUserPantryMembership(_pantryId: string, _userId: number) {
      return null;
    },
    async getPantryMembers(_pantryId: string) {
      return [];
    },
    async createPantryInvite(pantryId: string, createdBy: number, code: string, expiresAt: string, maxUses: number) {
      return { code, pantry_id: pantryId, created_by: createdBy, expires_at: expiresAt, max_uses: maxUses, uses: 0 };
    },
    async getInvite(_code: string) {
      return null;
    },
    async joinPantryViaInvite(_code: string, _userId: number) {
      throw new Error('Not implemented in session tests');
    },
    async leavePantry(_pantryId: string, _userId: number) {},
    async deletePantry(_pantryId: string, _ownerId: number) {},
    async removePantryMember(_pantryId: string, _ownerId: number, _targetUserId: number) {},
    async updateCanWritePm(_userId: number, _canWrite: boolean) {},
    async getProduct(_barcode: string) {
      return null;
    },
    async upsertProduct(barcode: string, name: string, source: 'manual' | 'off') {
      return { barcode, name, source, updated_at: new Date().toISOString() };
    },
    async createItem(_item: CreateItemData): Promise<ItemRecord> {
      throw new Error('Not implemented in session tests');
    },
    async getPantryItems(_pantryId: string, _status?: 'active' | 'consumed' | 'discarded'): Promise<ItemRecord[]> {
      return [];
    },
    async getItem(_itemId: string): Promise<ItemRecord | null> {
      return null;
    },
    async updateItem(_itemId: string, _updates: UpdateItemData): Promise<ItemRecord> {
      throw new Error('Not implemented in session tests');
    },
    async getActiveItemsByBarcode(_pantryId: string, _barcode: string): Promise<ItemRecord[]> {
      return [];
    },
    async findActiveItem(_pantryId: string, _exp: string, _bc?: string | null, _name?: string): Promise<ItemRecord | null> {
      return null;
    },
    async deleteItems(_itemIds: string[]): Promise<void> {},
    async clearActivePantryItems(_pantryId: string): Promise<void> {},
  };
}

describe('API POST /session Pure Handler', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let deps: ApiDependencies;
  const fixedNow = new Date('2026-09-29T12:00:00Z');

  beforeEach(() => {
    mockDb = createMockDb();
    deps = {
      db: mockDb,
      botToken: TEST_BOT_TOKEN,
      now: () => fixedNow,
    };
  });

  const testUser: TelegramUser = {
    id: 1001,
    first_name: 'Kirill',
    username: 'dungeon_master',
    language_code: 'ru',
  };

  it('rejects requests without Authorization header with 401', async () => {
    const req = new Request('https://example.com/api/session', {
      method: 'POST',
    });

    const res = await handleApiRequest(req, deps);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Отсутствует или некорректен заголовок авторизации');
  });

  it('rejects requests with forged/tampered initData signature with 401', async () => {
    const rawInitData = await createTestInitData(testUser, 'WRONG_BOT_TOKEN', {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    const req = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: {
        Authorization: `tma ${rawInitData}`,
      },
    });

    const res = await handleApiRequest(req, deps);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Неверная цифровая подпись');
  });

  it('rejects requests when user is not in allowed_users with 403 NOT_ALLOWED', async () => {
    // User is NOT added to allowedUsersSet
    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    const req = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: {
        Authorization: `tma ${rawInitData}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timezone: 'Europe/Moscow' }),
    });

    const res = await handleApiRequest(req, deps);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NOT_ALLOWED');
  });

  it('registers allowed user, saves timezone and creates personal pantry on first login', async () => {
    mockDb.allowedUsersSet.add(1001);

    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    const req = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: {
        Authorization: `tma ${rawInitData}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timezone: 'Europe/Madrid' }),
    });

    const res = await handleApiRequest(req, deps);
    expect(res.status).toBe(200);

    const data: SessionResponse = await res.json();
    expect(data.user.telegram_id).toBe(1001);
    expect(data.user.first_name).toBe('Kirill');
    expect(data.user.timezone).toBe('Europe/Madrid');
    expect(data.pantries.length).toBe(1);
    expect(data.currentPantry.name).toBe('Мой склад');
    expect(data.currentPantry.role).toBe('owner');
  });

  it('is idempotent on subsequent /session requests without creating duplicate pantries', async () => {
    mockDb.allowedUsersSet.add(1001);

    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    // Call 1
    const req1 = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: { Authorization: `tma ${rawInitData}` },
      body: JSON.stringify({ timezone: 'Europe/Moscow' }),
    });
    const res1 = await handleApiRequest(req1, deps);
    expect(res1.status).toBe(200);
    const data1: SessionResponse = await res1.json();
    const pantryId = data1.currentPantry.id;

    // Call 2 with updated timezone
    const req2 = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: { Authorization: `tma ${rawInitData}` },
      body: JSON.stringify({ timezone: 'Europe/Madrid' }),
    });
    const res2 = await handleApiRequest(req2, deps);
    expect(res2.status).toBe(200);
    const data2: SessionResponse = await res2.json();

    // User is updated
    expect(data2.user.timezone).toBe('Europe/Madrid');
    // Still only 1 pantry and same ID
    expect(data2.pantries.length).toBe(1);
    expect(data2.currentPantry.id).toBe(pantryId);
    expect(mockDb.usersMap.size).toBe(1);
    expect(mockDb.pantriesMap.size).toBe(1);
  });

  it('enforces maximum 10 users limit for new registrations', async () => {
    // Pre-populate 10 users in DB
    for (let i = 1; i <= 10; i++) {
      mockDb.allowedUsersSet.add(i);
      await mockDb.upsertUser({
        telegram_id: i,
        first_name: `User ${i}`,
      });
    }

    expect(await mockDb.getUsersCount()).toBe(10);

    // 11th user tries to register
    const user11: TelegramUser = {
      id: 9999,
      first_name: 'Eleventh User',
    };
    mockDb.allowedUsersSet.add(9999);

    const rawInitData = await createTestInitData(user11, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    const req = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: { Authorization: `tma ${rawInitData}` },
    });

    const res = await handleApiRequest(req, deps);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('USER_LIMIT_REACHED');

    // Existing user from the 10 can still log in without error
    const existingUser: TelegramUser = {
      id: 5,
      first_name: 'User 5',
    };
    const rawExisting = await createTestInitData(existingUser, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    const reqExisting = new Request('https://example.com/api/session', {
      method: 'POST',
      headers: { Authorization: `tma ${rawExisting}` },
    });

    const resExisting = await handleApiRequest(reqExisting, deps);
    expect(resExisting.status).toBe(200);
  });
});
