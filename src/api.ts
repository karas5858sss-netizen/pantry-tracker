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

export interface SessionData {
  user: SessionUser;
  pantries: Pantry[];
  currentPantry: Pantry;
}

export interface ApiError {
  error: string;
  code?: 'NOT_ALLOWED' | 'USER_LIMIT_REACHED' | 'AUTH_FAILED';
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Initializes session by calling POST /functions/v1/api/session.
 * Sends raw Telegram initData in "Authorization: tma <initData>".
 */
export async function fetchSession(): Promise<{ data?: SessionData; error?: ApiError }> {
  const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData || '' : '';

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
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
    const endpoint = `${SUPABASE_URL}/functions/v1/api/session`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `tma ${initData}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ timezone }),
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

    return { data: body as SessionData };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Session fetch error:', err);
    return {
      error: {
        error: `Не удалось подключиться к серверу API (${errMsg}).`,
        code: 'AUTH_FAILED',
      },
    };
  }
}
