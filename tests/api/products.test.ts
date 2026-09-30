import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { handleApiRequest } from '../../supabase/functions/api/handler.ts';
import { createTestInitData, type TelegramUser } from '../../shared/telegramAuth.ts';
import type {
  DatabaseClient,
  ApiDependencies,
  ProductRecord,
  CreateItemData,
  ItemRecord,
  UpdateItemData,
} from '../../supabase/functions/api/types.ts';

const TEST_BOT_TOKEN = '123456789:ABCDEF_mock_bot_token_for_tests';

function createMockDb(): DatabaseClient & {
  allowedUsersSet: Set<number>;
  productsMap: Map<string, ProductRecord>;
} {
  const allowedUsersSet = new Set<number>();
  const productsMap = new Map<string, ProductRecord>();

  return {
    allowedUsersSet,
    productsMap,

    async isUserAllowed(telegramId: number) {
      return allowedUsersSet.has(telegramId);
    },
    async getUsersCount() {
      return 1;
    },
    async getUser() {
      return null;
    },
    async upsertUser() {
      throw new Error('Not used in product tests');
    },
    async getUserPantries() {
      return [];
    },
    async createPantry() {
      throw new Error('Not used in product tests');
    },
    async getUserPantryMembership() {
      return null;
    },
    async getPantryMembers() {
      return [];
    },
    async createPantryInvite() {
      throw new Error('Not used in product tests');
    },
    async getInvite() {
      return null;
    },
    async joinPantryViaInvite() {
      throw new Error('Not used in product tests');
    },
    async leavePantry() {},
    async deletePantry() {},
    async removePantryMember() {},
    async updateCanWritePm() {},

    // Stage 3 methods
    async getProduct(barcode: string) {
      return productsMap.get(barcode) || null;
    },

    async upsertProduct(barcode: string, name: string, source: 'manual' | 'off') {
      const rec: ProductRecord = {
        barcode,
        name,
        source,
        updated_at: new Date().toISOString(),
      };
      productsMap.set(barcode, rec);
      return rec;
    },

    async createItem(_item: CreateItemData): Promise<ItemRecord> {
      throw new Error('Not implemented in product tests');
    },
    async getPantryItems(_pantryId: string, _status?: 'active' | 'consumed' | 'discarded'): Promise<ItemRecord[]> {
      return [];
    },
    async getItem(_itemId: string): Promise<ItemRecord | null> {
      return null;
    },
    async updateItem(_itemId: string, _updates: UpdateItemData): Promise<ItemRecord> {
      throw new Error('Not implemented in product tests');
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

describe('Stage 3: Products Resolution & Catalog API', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let deps: ApiDependencies;
  let mockFetchOffProduct: Mock<(barcode: string, lang: 'ru' | 'es' | 'en') => Promise<string | null>>;
  const fixedNow = new Date('2026-09-29T12:00:00Z');

  const testUser: TelegramUser = { id: 1001, first_name: 'Kirill', language_code: 'ru' };

  beforeEach(() => {
    mockDb = createMockDb();
    mockDb.allowedUsersSet.add(testUser.id);

    mockFetchOffProduct = vi.fn();

    deps = {
      db: mockDb,
      botToken: TEST_BOT_TOKEN,
      now: () => fixedNow,
      fetchOffProduct: mockFetchOffProduct,
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

  it('rejects unallowed user with 403', async () => {
    const intruder: TelegramUser = { id: 9999, first_name: 'Intruder' };
    const res = await makeAuthRequest(intruder, 'GET', '/products/4607004891118');

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Доступ запрещен');
  });

  it('priority 1: returns product from local DB and does NOT call Open Food Facts', async () => {
    mockDb.productsMap.set('4607004891118', {
      barcode: '4607004891118',
      name: 'Хлеб Бородинский',
      source: 'manual',
      updated_at: fixedNow.toISOString(),
    });

    const res = await makeAuthRequest(testUser, 'GET', '/products/4607004891118');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.found).toBe(true);
    expect(data.product.name).toBe('Хлеб Бородинский');
    expect(data.product.source).toBe('manual');
    expect(mockFetchOffProduct).not.toHaveBeenCalled();
  });

  it('priority 2: queries OFF if not in DB, returns product and caches it with source off', async () => {
    mockFetchOffProduct.mockResolvedValueOnce('Сыр Российский');

    const res = await makeAuthRequest(testUser, 'GET', '/products/4607004892225?lang=ru');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.found).toBe(true);
    expect(data.product.name).toBe('Сыр Российский');
    expect(data.product.source).toBe('off');
    expect(mockFetchOffProduct).toHaveBeenCalledWith('4607004892225', 'ru');

    // Verify it was cached in local DB
    const cached = mockDb.productsMap.get('4607004892225');
    expect(cached).toBeDefined();
    expect(cached?.name).toBe('Сыр Российский');
    expect(cached?.source).toBe('off');
  });

  it('priority 3: returns found: false when product is neither in DB nor in OFF', async () => {
    mockFetchOffProduct.mockResolvedValueOnce(null);

    const res = await makeAuthRequest(testUser, 'GET', '/products/9999999999999');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.found).toBe(false);
    expect(data.product).toBeNull();
  });

  it('handles OFF exceptions/timeouts gracefully by returning found: false', async () => {
    mockFetchOffProduct.mockRejectedValueOnce(new Error('Network timeout or AbortController'));

    const res = await makeAuthRequest(testUser, 'GET', '/products/1234567890128');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.found).toBe(false);
    expect(data.product).toBeNull();
  });

  it('POST /products saves a manual product entry with source manual', async () => {
    const res = await makeAuthRequest(testUser, 'POST', '/products', {
      barcode: '4006381333931',
      name: 'Стабило Маркер Желтый',
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.product.barcode).toBe('4006381333931');
    expect(data.product.name).toBe('Стабило Маркер Желтый');
    expect(data.product.source).toBe('manual');

    // Verify it is in DB
    expect(mockDb.productsMap.get('4006381333931')?.name).toBe('Стабило Маркер Желтый');
  });

  it('POST /products validates required fields', async () => {
    const res = await makeAuthRequest(testUser, 'POST', '/products', {
      barcode: '4006381333931',
      name: '   ',
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Название товара не может быть пустым');
  });
});
