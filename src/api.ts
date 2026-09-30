/**
 * Client API for interacting with Supabase Edge Functions.
 * Follows strict security rules:
 * - Uses ONLY the publishable/anon key and user's raw initData.
 * - NEVER uses initDataUnsafe for authorization.
 * - NEVER references service role key.
 */

import {
  getOffApiUrl,
  getOpfApiUrl,
  getObfApiUrl,
  getUpcItemDbUrl,
  extractOffProductName,
  extractUpcProductName,
} from '@shared/products.ts';

export interface SessionUser {
  telegram_id: number;
  first_name: string;
  username: string | null;
  language_code: string;
  timezone: string;
  reminder_hour: number;
  reminders_enabled: boolean;
  can_write_pm: boolean;
}

export interface Pantry {
  id: string;
  name: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface PantryMember {
  pantry_id: string;
  user_id: number;
  role: 'owner' | 'member';
  first_name: string;
  username: string | null;
  joined_at: string;
}

export interface SessionData {
  user: SessionUser;
  pantries: Pantry[];
  currentPantry: Pantry;
}

export interface ApiError {
  error: string;
  code?: 'NOT_ALLOWED' | 'USER_LIMIT_REACHED' | 'AUTH_FAILED' | 'INVITE_EXPIRED' | 'INVITE_ALREADY_USED' | 'FORBIDDEN';
}

export interface InviteInfo {
  code: string;
  inviteUrl: string;
  expiresAt: string;
  maxUses: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

function getInitData(): string {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData || '' : '';
}

async function requestApi<T>(path: string, options: RequestInit = {}): Promise<{ data?: T; error?: ApiError }> {
  const initData = getInitData();

  if (!initData) {
    return {
      error: {
        error: 'Приложение открыто вне Telegram. Откройте приложение через Telegram-бота для авторизации.',
        code: 'AUTH_FAILED',
      },
    };
  }

  if (!SUPABASE_URL) {
    return {
      error: {
        error: 'Не настроен VITE_SUPABASE_URL в переменных окружения.',
        code: 'AUTH_FAILED',
      },
    };
  }

  try {
    const endpoint = `${SUPABASE_URL}/functions/v1/api${path}`;
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `tma ${initData}`);
    headers.set('apikey', SUPABASE_ANON_KEY);

    const response = await fetch(endpoint, {
      ...options,
      headers,
    });

    const body = await response.json();

    if (!response.ok) {
      return {
        error: {
          error: body.error || `Ошибка сервера (${response.status})`,
          code: body.code,
        },
      };
    }

    return { data: body as T };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`API request error [${path}]:`, err);
    return {
      error: {
        error: `Не удалось подключиться к серверу API (${errMsg}).`,
        code: 'AUTH_FAILED',
      },
    };
  }
}

/**
 * Initializes session by calling POST /api/session.
 */
export async function fetchSession(): Promise<{ data?: SessionData; error?: ApiError }> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  return requestApi<SessionData>('/session', {
    method: 'POST',
    body: JSON.stringify({ timezone }),
  });
}

/**
 * Updates can_write_pm after user grants write access in Telegram.
 */
export async function updateWriteAccess(canWrite: boolean): Promise<{ success: boolean }> {
  const res = await requestApi<{ success: boolean }>('/user/write-access', {
    method: 'POST',
    body: JSON.stringify({ can_write_pm: canWrite }),
  });
  return { success: !res.error };
}

/**
 * Creates a new personal or shared pantry.
 */
export async function createPantry(name: string): Promise<{ data?: { pantry: Pantry }; error?: ApiError }> {
  return requestApi<{ pantry: Pantry }>('/pantries', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * Generates an invite link (48 hours, 1 use) for a pantry.
 */
export async function createInvite(pantryId: string): Promise<{ data?: InviteInfo; error?: ApiError }> {
  return requestApi<InviteInfo>(`/pantries/${pantryId}/invites`, {
    method: 'POST',
  });
}

/**
 * Joins a pantry via an invite code (from startapp=join_<code>).
 */
export async function joinPantry(code: string): Promise<{ data?: { pantry: Pantry; alreadyMember: boolean; pantries: Pantry[] }; error?: ApiError }> {
  return requestApi<{ pantry: Pantry; alreadyMember: boolean; pantries: Pantry[] }>('/invites/join', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/**
 * Fetches members of a pantry.
 */
export async function getPantryMembers(pantryId: string): Promise<{ data?: { members: PantryMember[] }; error?: ApiError }> {
  return requestApi<{ members: PantryMember[] }>(`/pantries/${pantryId}/members`, {
    method: 'GET',
  });
}

/**
 * Member leaves a pantry.
 */
export async function leavePantry(pantryId: string): Promise<{ data?: { success: boolean; pantries: Pantry[] }; error?: ApiError }> {
  return requestApi<{ success: boolean; pantries: Pantry[] }>(`/pantries/${pantryId}/leave`, {
    method: 'POST',
  });
}

/**
 * Owner deletes a pantry.
 */
export async function deletePantry(pantryId: string): Promise<{ data?: { success: boolean; pantries: Pantry[] }; error?: ApiError }> {
  return requestApi<{ success: boolean; pantries: Pantry[] }>(`/pantries/${pantryId}`, {
    method: 'DELETE',
  });
}

/**
 * Owner removes a member from the pantry.
 */
export async function removePantryMember(pantryId: string, userId: number): Promise<{ data?: { success: boolean; members: PantryMember[] }; error?: ApiError }> {
  return requestApi<{ success: boolean; members: PantryMember[] }>(`/pantries/${pantryId}/members/remove`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export interface ProductInfo {
  barcode: string;
  name: string;
  source: 'manual' | 'off';
}

/**
 * Resolves a barcode against (1) internal DB -> (2) Open Food Facts -> (3) manual.
 */
export async function lookupProduct(
  barcode: string,
  lang: 'ru' | 'es' | 'en' = 'ru'
): Promise<{ found: boolean; product: ProductInfo | null }> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return { found: false, product: null };

  // 1. Try our backend (which checks local DB and server-side OFF fallback)
  const res = await requestApi<{ found: boolean; product: ProductInfo | null }>(
    `/products/${encodeURIComponent(cleanBarcode)}?lang=${lang}`,
    { method: 'GET' }
  );

  if (res.data?.found && res.data.product) {
    return { found: true, product: res.data.product };
  }

  // 2. Direct client query to Open Food Facts, Open Products Facts, Open Beauty Facts, and UPCitemdb
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const fetchJson = async (url: string) => {
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const [offJson, opfJson, obfJson, upcJson] = await Promise.all([
      fetchJson(getOffApiUrl(cleanBarcode)),
      fetchJson(getOpfApiUrl(cleanBarcode)),
      fetchJson(getObfApiUrl(cleanBarcode)),
      fetchJson(getUpcItemDbUrl(cleanBarcode)),
    ]);
    clearTimeout(timeout);

    const foundName =
      extractOffProductName(offJson, lang) ||
      extractOffProductName(opfJson, lang) ||
      extractOffProductName(obfJson, lang) ||
      extractUpcProductName(upcJson);

    if (foundName) {
      saveProduct(cleanBarcode, foundName, 'off').catch(() => {});
      return {
        found: true,
        product: {
          barcode: cleanBarcode,
          name: foundName,
          source: 'off',
        },
      };
    }
  } catch {
    // Ignore client fetch errors and fall back to manual
  }

  return { found: false, product: null };
}

/**
 * Saves or updates a product in the catalog.
 */
export async function saveProduct(
  barcode: string,
  name: string,
  source: 'manual' | 'off' = 'manual'
): Promise<{ data?: { product: ProductInfo }; error?: ApiError }> {
  return requestApi<{ product: ProductInfo }>('/products', {
    method: 'POST',
    body: JSON.stringify({ barcode, name, source }),
  });
}

// Stage 4: Pantry Items & Expiration Dates

export interface PantryItem {
  id: string;
  pantry_id: string;
  barcode: string | null;
  name: string;
  expiration_date: string;
  quantity: number;
  status: 'active' | 'consumed' | 'discarded';
  created_by: number;
  created_at: string;
  closed_at: string | null;
}

export interface CreateItemPayload {
  name: string;
  expiration_date: string;
  barcode?: string | null;
  quantity?: number;
}

/**
 * Adds an item with expiration date to a pantry.
 */
export async function createItem(
  pantryId: string,
  payload: CreateItemPayload
): Promise<{ data?: { item: PantryItem }; error?: ApiError }> {
  return requestApi<{ item: PantryItem }>(`/pantries/${pantryId}/items`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetches items from a pantry.
 */
export async function getPantryItems(
  pantryId: string,
  status: 'active' | 'consumed' | 'discarded' = 'active'
): Promise<{ data?: { items: PantryItem[] }; error?: ApiError }> {
  return requestApi<{ items: PantryItem[] }>(`/pantries/${pantryId}/items?status=${status}`, {
    method: 'GET',
  });
}

export interface ItemPreviousState {
  id: string;
  quantity: number;
  status: 'active' | 'consumed' | 'discarded';
  closed_at: string | null;
}

export interface ConsumeItemResponse {
  item: PantryItem;
  previousState: ItemPreviousState;
  action: 'consumed' | 'discarded';
}

export interface ConsumeFifoResponse {
  found: boolean;
  multipleBatches?: boolean;
  items?: PantryItem[];
  item?: PantryItem;
  previousState?: ItemPreviousState;
  action?: 'consumed' | 'discarded';
}

/**
 * Consumes an item (decrements quantity or sets status = 'consumed').
 */
export async function consumeItem(
  pantryId: string,
  itemId: string,
  action: 'consumed' | 'discarded' = 'consumed',
  all: boolean = false
): Promise<{ data?: ConsumeItemResponse; error?: ApiError }> {
  const verb = action === 'consumed' ? 'consume' : 'discard';
  return requestApi<ConsumeItemResponse>(`/pantries/${pantryId}/items/${itemId}/${verb}`, {
    method: 'POST',
    body: JSON.stringify({ all }),
  });
}

/**
 * Restores an item to its previous state (Undo operation).
 */
export async function restoreItem(
  pantryId: string,
  itemId: string,
  previousState: ItemPreviousState
): Promise<{ data?: { item: PantryItem }; error?: ApiError }> {
  return requestApi<{ item: PantryItem }>(`/pantries/${pantryId}/items/${itemId}/restore`, {
    method: 'POST',
    body: JSON.stringify({
      quantity: previousState.quantity,
      status: previousState.status,
      closed_at: previousState.closed_at,
    }),
  });
}

/**
 * Updates the quantity of an item directly without scanning.
 */
export async function updateItemQuantity(
  pantryId: string,
  itemId: string,
  quantity: number
): Promise<{ data?: { item: PantryItem; previousState: ItemPreviousState }; error?: ApiError }> {
  return requestApi<{ item: PantryItem; previousState: ItemPreviousState }>(
    `/pantries/${pantryId}/items/${itemId}/quantity`,
    {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    }
  );
}

/**
 * Consumes an item by barcode using FIFO (First-In, First-Out).
 */
export async function consumeBarcodeFifo(
  pantryId: string,
  barcode: string,
  options?: {
    itemId?: string;
    action?: 'consumed' | 'discarded';
    force?: boolean;
  }
): Promise<{ data?: ConsumeFifoResponse; error?: ApiError }> {
  return requestApi<ConsumeFifoResponse>(`/pantries/${pantryId}/items/consume-barcode`, {
    method: 'POST',
    body: JSON.stringify({
      barcode,
      itemId: options?.itemId,
      action: options?.action,
      force: options?.force,
    }),
  });
}

/**
 * Clears all active items from the pantry.
 */
export async function clearPantryItems(
  pantryId: string
): Promise<{ data?: { success: boolean }; error?: ApiError }> {
  return requestApi<{ success: boolean }>(`/pantries/${pantryId}/items/clear`, {
    method: 'POST',
  });
}

export interface UpdateUserSettingsPayload {
  reminder_hour?: number;
  reminders_enabled?: boolean;
  timezone?: string;
}

/**
 * Updates user reminder settings (hour, enabled/disabled, timezone).
 */
export async function updateUserSettings(
  payload: UpdateUserSettingsPayload
): Promise<{ data?: { user: SessionUser }; error?: ApiError }> {
  return requestApi<{ user: SessionUser }>('/user/settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}



