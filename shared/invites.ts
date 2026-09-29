/**
 * Pure helper functions for pantry invites and deep link parsing.
 * Code format: >= 16 characters using url-safe [A-Za-z0-9_-].
 */

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Generates a cryptographically strong random invite code (default 24 characters).
 */
export function generateInviteCode(length: number = 24): string {
  const codeLength = Math.max(16, length);
  const randomValues = new Uint8Array(codeLength);
  crypto.getRandomValues(randomValues);

  let result = '';
  for (let i = 0; i < codeLength; i++) {
    result += CHARSET[randomValues[i] % CHARSET.length];
  }
  return result;
}

/**
 * Validates whether an invite code matches the schema (>=16 chars, valid characters).
 */
export function isValidInviteCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  return /^[A-Za-z0-9_-]{16,64}$/.test(code);
}

/**
 * Formats a Telegram Mini App deep link for joining a pantry.
 * Example: https://t.me/sklad_jli_bot/app?startapp=join_abc1234567890123
 */
export function formatInviteLink(botName: string, appShortName: string, code: string): string {
  const cleanBot = botName.replace(/^@/, '');
  const cleanApp = appShortName || 'app';
  return `https://t.me/${cleanBot}/${cleanApp}?startapp=join_${code}`;
}

/**
 * Parses start_param from Telegram WebApp.
 * If user clicked https://t.me/bot/app?startapp=join_XXXX,
 * Telegram sets initDataUnsafe.start_param to "join_XXXX".
 */
export function parseStartParam(startParam?: string): { type: 'join'; code: string } | null {
  if (!startParam || typeof startParam !== 'string') return null;

  if (startParam.startsWith('join_')) {
    const code = startParam.slice(5).trim();
    if (isValidInviteCode(code)) {
      return { type: 'join', code };
    }
  }

  return null;
}
