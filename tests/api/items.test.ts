import { describe, it, expect, beforeEach } from 'vitest';
import { handleApiRequest } from '../../supabase/functions/api/handler.ts';
import { createTestInitData, type TelegramUser } from '../../shared/telegramAuth.ts';
import { consolidatePantryItems } from '../../shared/inventory.ts';
import type {
  DatabaseClient,
  ApiDependencies,
  UserRecord,
  PantryRecord,
  PantryMemberRecord,
  InviteRecord,
  UpsertUserData,
  CreateItemData,
  ItemRecord,
  ProductRecord,
  UpdateItemData,
} from '../../supabase/functions/api/types.ts';

const TEST_BOT_TOKEN = '123456789:ABCDEF_mock_bot_token_for_tests';

function createMockDb(): DatabaseClient & {
  allowedUsersSet: Set<number>;
  usersMap: Map<number, UserRecord>;
  pantriesMap: Map<string, { id: string; name: string; created_at: string }>;
  membersList: Array<{ pantry_id: string; user_id: number; role: 'owner' | 'member'; joined_at: string }>;
  itemsList: ItemRecord[];
  productsMap: Map<string, ProductRecord>;
} {
  const allowedUsersSet = new Set<number>();
  const usersMap = new Map<number, UserRecord>();
  const pantriesMap = new Map<string, { id: string; name: string; created_at: string }>();
  const membersList: Array<{ pantry_id: string; user_id: number; role: 'owner' | 'member'; joined_at: string }> = [];
  const itemsList: ItemRecord[] = [];
  const productsMap = new Map<string, ProductRecord>();

  return {
    allowedUsersSet,
    usersMap,
    pantriesMap,
    membersList,
    itemsList,
    productsMap,

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
      membersList.push({ pantry_id: id, user_id: ownerTelegramId, role: 'owner', joined_at: created_at });
      return { id, name, role: 'owner', created_at };
    },

    async getUserPantryMembership(pantryId: string, userId: number): Promise<'owner' | 'member' | null> {
      const entry = membersList.find((m) => m.pantry_id === pantryId && m.user_id === userId);
      return entry ? entry.role : null;
    },

    async getPantryMembers(pantryId: string): Promise<PantryMemberRecord[]> {
      return membersList
        .filter((m) => m.pantry_id === pantryId)
        .map((m) => {
          const user = usersMap.get(m.user_id);
          return {
            pantry_id: m.pantry_id,
            user_id: m.user_id,
            role: m.role,
            first_name: user?.first_name || `User ${m.user_id}`,
            username: user?.username || null,
            joined_at: m.joined_at,
          };
        });
    },

    async createPantryInvite(
      pantryId: string,
      createdBy: number,
      code: string,
      expiresAt: string,
      maxUses: number
    ): Promise<InviteRecord> {
      return { code, pantry_id: pantryId, created_by: createdBy, expires_at: expiresAt, max_uses: maxUses, uses: 0 };
    },

    async getInvite(_code: string): Promise<InviteRecord | null> {
      return null;
    },

    async joinPantryViaInvite(_code: string, _userId: number): Promise<{ pantry: PantryRecord; alreadyMember: boolean }> {
      throw new Error('Not implemented in items tests');
    },

    async leavePantry(pantryId: string, userId: number): Promise<void> {
      const idx = membersList.findIndex((m) => m.pantry_id === pantryId && m.user_id === userId);
      if (idx !== -1) membersList.splice(idx, 1);
    },

    async deletePantry(pantryId: string, _ownerId: number): Promise<void> {
      pantriesMap.delete(pantryId);
      for (let i = membersList.length - 1; i >= 0; i--) {
        if (membersList[i].pantry_id === pantryId) {
          membersList.splice(i, 1);
        }
      }
    },

    async removePantryMember(pantryId: string, _ownerId: number, targetUserId: number): Promise<void> {
      const idx = membersList.findIndex((m) => m.pantry_id === pantryId && m.user_id === targetUserId);
      if (idx !== -1) membersList.splice(idx, 1);
    },

    async updateCanWritePm(userId: number, canWrite: boolean): Promise<void> {
      const user = usersMap.get(userId);
      if (user) user.can_write_pm = canWrite;
    },

    async updateUserSettings(_userId: number, _settings: any): Promise<UserRecord> {
      throw new Error('Not implemented in items tests');
    },

    async getProduct(barcode: string): Promise<ProductRecord | null> {
      return productsMap.get(barcode) || null;
    },

    async upsertProduct(barcode: string, name: string, source: 'manual' | 'off'): Promise<ProductRecord> {
      const rec: ProductRecord = {
        barcode,
        name,
        source,
        updated_at: new Date().toISOString(),
      };
      productsMap.set(barcode, rec);
      return rec;
    },

    async createItem(itemData: CreateItemData): Promise<ItemRecord> {
      const rec: ItemRecord = {
        id: `item-${itemsList.length + 1}`,
        pantry_id: itemData.pantry_id,
        barcode: itemData.barcode ?? null,
        name: itemData.name,
        expiration_date: itemData.expiration_date,
        quantity: itemData.quantity ?? 1,
        status: 'active',
        created_by: itemData.created_by,
        created_at: new Date().toISOString(),
        closed_at: null,
      };
      itemsList.push(rec);
      return rec;
    },

    async getPantryItems(pantryId: string, status: 'active' | 'consumed' | 'discarded' = 'active'): Promise<ItemRecord[]> {
      const filtered = itemsList
        .filter((item) => item.pantry_id === pantryId && item.status === status)
        .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));

      if (status !== 'active' || filtered.length <= 1) {
        return filtered;
      }

      const { consolidated, duplicatesToRemove, updatedQuantities } = consolidatePantryItems(filtered);
      if (duplicatesToRemove.length > 0) {
        for (const [id, qty] of updatedQuantities.entries()) {
          const it = itemsList.find((i) => i.id === id);
          if (it) it.quantity = qty;
        }
        const toRemove = new Set(duplicatesToRemove);
        const remaining = itemsList.filter((i) => !toRemove.has(i.id));
        itemsList.length = 0;
        itemsList.push(...remaining);
      }
      return consolidated;
    },

    async getItem(itemId: string): Promise<ItemRecord | null> {
      return itemsList.find((i) => i.id === itemId) || null;
    },

    async updateItem(itemId: string, updates: UpdateItemData): Promise<ItemRecord> {
      const item = itemsList.find((i) => i.id === itemId);
      if (!item) {
        throw new Error('Item not found');
      }
      if (updates.quantity !== undefined) item.quantity = updates.quantity;
      if (updates.status !== undefined) item.status = updates.status;
      if (updates.closed_at !== undefined) item.closed_at = updates.closed_at;
      return { ...item };
    },

    async getActiveItemsByBarcode(pantryId: string, barcode: string): Promise<ItemRecord[]> {
      return itemsList
        .filter((item) => item.pantry_id === pantryId && item.barcode === barcode && item.status === 'active')
        .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
    },

    async findActiveItem(
      pantryId: string,
      expirationDate: string,
      barcode?: string | null,
      name?: string
    ): Promise<ItemRecord | null> {
      return itemsList.find((item) => {
        if (item.pantry_id !== pantryId || item.expiration_date !== expirationDate || item.status !== 'active') {
          return false;
        }
        if (barcode && barcode.trim()) {
          return item.barcode === barcode.trim();
        }
        if (name && name.trim()) {
          return !item.barcode && item.name.trim().toLowerCase() === name.trim().toLowerCase();
        }
        return false;
      }) || null;
    },

    async deleteItems(itemIds: string[]): Promise<void> {
      const toRemove = new Set(itemIds);
      const remaining = itemsList.filter((i) => !toRemove.has(i.id));
      itemsList.length = 0;
      itemsList.push(...remaining);
    },

    async clearActivePantryItems(pantryId: string): Promise<void> {
      for (const item of itemsList) {
        if (item.pantry_id === pantryId && item.status === 'active') {
          item.status = 'discarded';
          item.closed_at = new Date().toISOString();
        }
      }
    },
  };
}

describe('Stage 4: Items & Expiration Dates API', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let deps: ApiDependencies;
  const fixedNow = new Date('2026-09-30T12:00:00Z');

  const ownerUser: TelegramUser = { id: 1001, first_name: 'Kirill', language_code: 'ru' };
  const strangerUser: TelegramUser = { id: 2002, first_name: 'Stranger', language_code: 'ru' };

  beforeEach(() => {
    mockDb = createMockDb();
    mockDb.allowedUsersSet.add(ownerUser.id);
    mockDb.allowedUsersSet.add(strangerUser.id);

    // Setup a pantry owned by ownerUser
    mockDb.pantriesMap.set('pantry-1', { id: 'pantry-1', name: 'Кухня', created_at: fixedNow.toISOString() });
    mockDb.membersList.push({
      pantry_id: 'pantry-1',
      user_id: ownerUser.id,
      role: 'owner',
      joined_at: fixedNow.toISOString(),
    });

    deps = {
      db: mockDb,
      botToken: TEST_BOT_TOKEN,
      now: () => fixedNow,
    };
  });

  async function makeAuthRequest(
    user: TelegramUser,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const raw = await createTestInitData(user, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    return handleApiRequest(
      new Request(`https://example.com/api${path}`, {
        method,
        headers: {
          Authorization: `tma ${raw}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      deps
    );
  }

  describe('POST /pantries/:id/items', () => {
    it('returns 403 if user is not in pantry', async () => {
      const res = await makeAuthRequest(strangerUser, 'POST', '/pantries/pantry-1/items', {
        name: 'Молоко 3.2%',
        expiration_date: '2026-10-07',
        quantity: 2,
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe('FORBIDDEN');
    });

    it('returns 400 if item name is missing or empty', async () => {
      const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        name: '   ',
        expiration_date: '2026-10-07',
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Название товара');
    });

    it('returns 400 if expiration date is invalid or out of range', async () => {
      // 1. Malformed date
      let res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        name: 'Йогурт',
        expiration_date: 'invalid-date',
      });
      expect(res.status).toBe(400);

      // 2. Impossible calendar date (Feb 30)
      res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        name: 'Йогурт',
        expiration_date: '2027-02-30',
      });
      expect(res.status).toBe(400);

      // 3. More than 1 year in the past (fixedNow is 2026-09-30, so 2025-08-01 is > 1 year ago)
      res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        name: 'Йогурт',
        expiration_date: '2025-08-01',
      });
      expect(res.status).toBe(400);
      const errPast = await res.json();
      expect(errPast.error).toContain('Срок годности');

      // 4. More than 10 years in the future (2037-01-01 is > 10 years ahead)
      res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        name: 'Йогурт',
        expiration_date: '2037-01-01',
      });
      expect(res.status).toBe(400);
    });

    it('successfully creates item with valid expiration date and quantity', async () => {
      const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        name: 'Творог 9%',
        expiration_date: '2026-10-07',
        quantity: 3,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.item).toBeDefined();
      expect(data.item.name).toBe('Творог 9%');
      expect(data.item.expiration_date).toBe('2026-10-07');
      expect(data.item.quantity).toBe(3);
      expect(data.item.status).toBe('active');
      expect(data.item.created_by).toBe(ownerUser.id);
      expect(data.item.pantry_id).toBe('pantry-1');
    });

    it('automatically saves product with barcode to collective catalog', async () => {
      const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        barcode: '4607004891234',
        name: 'Сок Яблочный 1л',
        expiration_date: '2027-03-31',
        quantity: 1,
      });

      expect(res.status).toBe(201);

      // Verify it was added to products catalog cache
      const productInCatalog = await mockDb.getProduct('4607004891234');
      expect(productInCatalog).not.toBeNull();
      expect(productInCatalog?.name).toBe('Сок Яблочный 1л');
    });

    it('increments quantity instead of duplicating when adding item with same expiration date and barcode', async () => {
      // 1. Add first time
      const res1 = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        barcode: '4609999999999',
        name: 'Кефир 1%',
        expiration_date: '2026-10-10',
        quantity: 1,
      });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      expect(data1.item.quantity).toBe(1);

      // 2. Add second time with same barcode and same date
      const res2 = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        barcode: '4609999999999',
        name: 'Кефир 1%',
        expiration_date: '2026-10-10',
        quantity: 2,
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.item.id).toBe(data1.item.id); // Same item updated!
      expect(data2.item.quantity).toBe(3); // 1 + 2 = 3

      // Verify pantry list only has 1 item for this product
      const listRes = await makeAuthRequest(ownerUser, 'GET', '/pantries/pantry-1/items');
      const listData = await listRes.json();
      const kefirItems = listData.items.filter((i: ItemRecord) => i.barcode === '4609999999999');
      expect(kefirItems).toHaveLength(1);
      expect(kefirItems[0].quantity).toBe(3);
    });

    it('creates separate batch when adding same barcode but with different expiration date', async () => {
      // Batch A: 2026-10-10
      await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        barcode: '4608888888888',
        name: 'Масло',
        expiration_date: '2026-10-10',
        quantity: 1,
      });

      // Batch B: 2026-10-25 (different expiration date!)
      const resB = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items', {
        barcode: '4608888888888',
        name: 'Масло',
        expiration_date: '2026-10-25',
        quantity: 2,
      });
      expect(resB.status).toBe(201);

      const listRes = await makeAuthRequest(ownerUser, 'GET', '/pantries/pantry-1/items');
      const listData = await listRes.json();
      const butterItems = listData.items.filter((i: ItemRecord) => i.barcode === '4608888888888');
      expect(butterItems).toHaveLength(2); // Two separate batches!
    });
  });

  describe('GET /pantries/:id/items', () => {
    beforeEach(async () => {
      // Add a couple items to mockDb
      await mockDb.createItem({
        pantry_id: 'pantry-1',
        name: 'Сыр Гауда',
        expiration_date: '2026-10-15',
        quantity: 1,
        created_by: ownerUser.id,
      });
      await mockDb.createItem({
        pantry_id: 'pantry-1',
        name: 'Молоко',
        expiration_date: '2026-10-03',
        quantity: 2,
        created_by: ownerUser.id,
      });
    });

    it('returns 403 if user is not in pantry', async () => {
      const res = await makeAuthRequest(strangerUser, 'GET', '/pantries/pantry-1/items');
      expect(res.status).toBe(403);
    });

    it('returns items ordered by expiration date (FIFO ready)', async () => {
      const res = await makeAuthRequest(ownerUser, 'GET', '/pantries/pantry-1/items');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(2);
      // '2026-10-03' should be first, '2026-10-15' second
      expect(data.items[0].name).toBe('Молоко');
      expect(data.items[1].name).toBe('Сыр Гауда');
    });
  });

  describe('Stage 5: Inventory Management, Consumption & FIFO API', () => {
    let itemMultiQty: ItemRecord;
    let itemSingleQty: ItemRecord;
    let batchEarlier: ItemRecord;
    let batchLater: ItemRecord;

    beforeEach(async () => {
      itemMultiQty = await mockDb.createItem({
        pantry_id: 'pantry-1',
        name: 'Йогурт клубничный',
        expiration_date: '2026-10-10',
        quantity: 3,
        created_by: ownerUser.id,
      });

      itemSingleQty = await mockDb.createItem({
        pantry_id: 'pantry-1',
        name: 'Хлеб бородинский',
        expiration_date: '2026-10-02',
        quantity: 1,
        created_by: ownerUser.id,
      });

      // Two batches of same product with same barcode but different dates
      batchEarlier = await mockDb.createItem({
        pantry_id: 'pantry-1',
        barcode: '4601234567890',
        name: 'Молоко 3.2%',
        expiration_date: '2026-10-04',
        quantity: 2,
        created_by: ownerUser.id,
      });

      batchLater = await mockDb.createItem({
        pantry_id: 'pantry-1',
        barcode: '4601234567890',
        name: 'Молоко 3.2%',
        expiration_date: '2026-10-12',
        quantity: 1,
        created_by: ownerUser.id,
      });
    });

    describe('Manual Consumption and Discarding', () => {
      it('decrements quantity by 1 and keeps status active when quantity > 1', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemMultiQty.id}/consume`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.id).toBe(itemMultiQty.id);
        expect(data.item.quantity).toBe(2);
        expect(data.item.status).toBe('active');
        expect(data.item.closed_at).toBeNull();
        expect(data.previousState.quantity).toBe(3);
      });

      it('closes item with status consumed and sets closed_at when quantity is 1', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/consume`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.id).toBe(itemSingleQty.id);
        expect(data.item.status).toBe('consumed');
        expect(data.item.closed_at).toBe(fixedNow.toISOString());
      });

      it('also supports /consumed alias for backwards/frontend compatibility', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/consumed`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.status).toBe('consumed');
      });

      it('closes item with status discarded when discarded', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/discard`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.id).toBe(itemSingleQty.id);
        expect(data.item.status).toBe('discarded');
        expect(data.item.closed_at).toBe(fixedNow.toISOString());
      });

      it('also supports /discarded alias for backwards/frontend compatibility', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/discarded`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.status).toBe('discarded');
      });

      it('restores previously consumed item back to active (Undo operation)', async () => {
        // 1. Consume
        const consumeRes = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/consume`);
        const consumeData = await consumeRes.json();
        expect(consumeData.item.status).toBe('consumed');

        // 2. Undo/Restore
        const restoreRes = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/restore`, {
          quantity: consumeData.previousState.quantity,
          status: consumeData.previousState.status,
          closed_at: consumeData.previousState.closed_at,
        });

        expect(restoreRes.status).toBe(200);
        const restoreData = await restoreRes.json();
        expect(restoreData.item.status).toBe('active');
        expect(restoreData.item.quantity).toBe(1);
        expect(restoreData.item.closed_at).toBeNull();
      });
    });

    describe('Direct Quantity Adjustment', () => {
      it('updates quantity directly via POST /pantries/:id/items/:itemId/quantity', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemMultiQty.id}/quantity`, {
          quantity: 10,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.id).toBe(itemMultiQty.id);
        expect(data.item.quantity).toBe(10);
        expect(data.item.status).toBe('active');
        expect(data.previousState.quantity).toBe(3);
      });

      it('updates quantity directly via PATCH /pantries/:id/items/:itemId', async () => {
        const res = await makeAuthRequest(ownerUser, 'PATCH', `/pantries/pantry-1/items/${itemMultiQty.id}`, {
          quantity: 5,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.id).toBe(itemMultiQty.id);
        expect(data.item.quantity).toBe(5);
        expect(data.item.status).toBe('active');
      });

      it('closes item as consumed when setting quantity to 0', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemSingleQty.id}/quantity`, {
          quantity: 0,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.id).toBe(itemSingleQty.id);
        expect(data.item.status).toBe('consumed');
        expect(data.item.closed_at).toBe(fixedNow.toISOString());
      });

      it('returns 400 for negative quantities', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', `/pantries/pantry-1/items/${itemMultiQty.id}/quantity`, {
          quantity: -3,
        });
        expect(res.status).toBe(400);
      });

      it('clears all active items in pantry via POST /pantries/:id/items/clear', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items/clear');
        expect(res.status).toBe(200);

        const listRes = await makeAuthRequest(ownerUser, 'GET', '/pantries/pantry-1/items');
        const listData = await listRes.json();
        expect(listData.items).toHaveLength(0);
      });
    });

    describe('FIFO Scan Consumption (POST /pantries/:id/items/consume-barcode)', () => {
      it('returns found: false when barcode does not exist in active inventory', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items/consume-barcode', {
          barcode: '9999999999999',
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.found).toBe(false);
      });

      it('detects multiple batches with different expiration dates and returns batch list without consuming', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items/consume-barcode', {
          barcode: '4601234567890',
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.found).toBe(true);
        expect(data.multipleBatches).toBe(true);
        expect(data.items).toHaveLength(2);
        // First batch should be earliest date (2026-10-04)
        expect(data.items[0].id).toBe(batchEarlier.id);
        expect(data.items[0].expiration_date).toBe('2026-10-04');
        expect(data.items[1].id).toBe(batchLater.id);
      });

      it('consumes earliest batch when force: true is passed (FIFO principle)', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items/consume-barcode', {
          barcode: '4601234567890',
          force: true,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.found).toBe(true);
        expect(data.multipleBatches).toBe(false);
        expect(data.item.id).toBe(batchEarlier.id);
        expect(data.item.quantity).toBe(1); // was 2, decremented to 1
        expect(data.item.status).toBe('active');
      });

      it('consumes specific batch when itemId is provided', async () => {
        const res = await makeAuthRequest(ownerUser, 'POST', '/pantries/pantry-1/items/consume-barcode', {
          barcode: '4601234567890',
          itemId: batchLater.id,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.found).toBe(true);
        expect(data.item.id).toBe(batchLater.id);
        expect(data.item.status).toBe('consumed'); // was 1, closed
      });
    });
  });
});

