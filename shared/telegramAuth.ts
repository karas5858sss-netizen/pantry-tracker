/**
 * Pure Telegram WebApp initData validation and parsing module.
 * Compliant with Telegram Mini Apps signature validation specifications.
 * Works in Node.js, Vitest, Deno, and Edge Functions using standard Web Crypto API.
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface ValidatedInitData {
  user: TelegramUser;
  auth_date: number;
  query_id?: string;
  start_param?: string;
  raw: Record<string, string>;
}

export interface AuthValidationResult {
  isValid: boolean;
  error?: string;
  data?: ValidatedInitData;
}

/**
 * Compares two hex strings in constant time to prevent timing attacks.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Calculates HMAC-SHA256 signature for Telegram data-check-string.
 * Secret = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
 * Signature = HMAC_SHA256(key=Secret, data=dataCheckString)
 */
export async function calculateInitDataHash(dataCheckString: string, botToken: string): Promise<string> {
  const enc = new TextEncoder();

  // Step 1: secret = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
  const secretKey = await crypto.subtle.importKey(
    'raw',
    enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const secretBuffer = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken));

  // Step 2: hash = HMAC_SHA256(key=secret, data=dataCheckString)
  const dataKey = await crypto.subtle.importKey(
    'raw',
    secretBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', dataKey, enc.encode(dataCheckString));

  // Convert to hex
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates Telegram initData string.
 *
 * Requirements:
 * 1. Extract and remove "hash" from query string.
 * 2. Sort remaining key=value pairs alphabetically and join with "\n".
 * 3. Verify HMAC-SHA256 hash using BOT_TOKEN.
 * 4. Verify auth_date is not older than 24 hours (86,400 seconds).
 *
 * @param initDataRaw Raw query string from Telegram.WebApp.initData
 * @param botToken Telegram bot token
 * @param now Reference timestamp (passed for deterministic testing)
 */
export async function validateTelegramInitData(
  initDataRaw: string,
  botToken: string,
  now: Date = new Date()
): Promise<AuthValidationResult> {
  if (!initDataRaw || typeof initDataRaw !== 'string') {
    return { isValid: false, error: 'Отсутствует строка initData' };
  }

  if (!botToken || typeof botToken !== 'string') {
    return { isValid: false, error: 'Отсутствует токен бота для проверки подписи' };
  }

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');

  if (!hash) {
    return { isValid: false, error: 'Отсутствует хэш подписи (hash)' };
  }

  const authDateStr = params.get('auth_date');
  if (!authDateStr || !/^\d+$/.test(authDateStr)) {
    return { isValid: false, error: 'Некорректная дата авторизации (auth_date)' };
  }

  const authDateSeconds = Number(authDateStr);
  const nowSeconds = Math.floor(now.getTime() / 1000);

  // Reject if auth_date is older than 24 hours (86400 seconds)
  const maxAgeSeconds = 24 * 60 * 60;
  if (nowSeconds - authDateSeconds > maxAgeSeconds) {
    return { isValid: false, error: 'Срок действия авторизации истек (старше 24 часов)' };
  }

  // Reject if auth_date is in the far future (> 60 seconds clock drift)
  if (authDateSeconds > nowSeconds + 60) {
    return { isValid: false, error: 'Некорректное время авторизации (время из будущего)' };
  }

  // Remove hash to create dataCheckString
  params.delete('hash');

  // Sort remaining keys alphabetically
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  // Verify signature
  const calculatedHash = await calculateInitDataHash(dataCheckString, botToken);
  const isSignatureValid = timingSafeEqualHex(calculatedHash.toLowerCase(), hash.toLowerCase());

  if (!isSignatureValid) {
    return { isValid: false, error: 'Неверная цифровая подпись Telegram initData' };
  }

  // Parse user object
  const userJson = params.get('user');
  if (!userJson) {
    return { isValid: false, error: 'Отсутствуют данные пользователя (user)' };
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userJson);
    if (!user || typeof user.id !== 'number' || !user.first_name) {
      return { isValid: false, error: 'Некорректный формат данных пользователя' };
    }
  } catch {
    return { isValid: false, error: 'Ошибка разбора JSON данных пользователя' };
  }

  const rawRecord: Record<string, string> = {};
  entries.forEach(([k, v]) => {
    rawRecord[k] = v;
  });

  return {
    isValid: true,
    data: {
      user,
      auth_date: authDateSeconds,
      query_id: params.get('query_id') || undefined,
      start_param: params.get('start_param') || undefined,
      raw: rawRecord,
    },
  };
}

/**
 * Helper to generate a valid test initData string for unit testing and CI.
 */
export async function createTestInitData(
  user: TelegramUser,
  botToken: string,
  options?: {
    authDateSeconds?: number;
    queryId?: string;
    startParam?: string;
    tamperField?: { key: string; value: string };
    omitHash?: boolean;
    invalidHash?: boolean;
  }
): Promise<string> {
  const params = new URLSearchParams();
  const authDate = options?.authDateSeconds ?? Math.floor(Date.now() / 1000);

  if (options?.queryId) params.set('query_id', options.queryId);
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(authDate));
  if (options?.startParam) params.set('start_param', options.startParam);

  if (options?.tamperField) {
    params.set(options.tamperField.key, options.tamperField.value);
  }

  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  let hash = await calculateInitDataHash(dataCheckString, botToken);
  if (options?.invalidHash) {
    hash = hash.slice(0, -4) + '0000';
  }

  if (!options?.omitHash) {
    params.set('hash', hash);
  }

  return params.toString();
}
