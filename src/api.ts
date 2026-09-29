/**
 * Client API for interacting with Supabase Edge Functions.
 * Follows strict security rules:
 * - Uses ONLY the publishable/anon key and user's raw initData.
 * - NEVER uses initDataUnsafe for authorization.
 * - NEVER references service role key.
 */

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
