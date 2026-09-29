import { describe, it, expect } from 'vitest';
import {
  validateTelegramInitData,
  createTestInitData,
  timingSafeEqualHex,
  calculateInitDataHash,
  type TelegramUser,
} from '../../shared/telegramAuth.ts';

describe('timingSafeEqualHex', () => {
  it('returns true for identical hex strings', () => {
    expect(timingSafeEqualHex('abcdef0123456789', 'abcdef0123456789')).toBe(true);
    expect(timingSafeEqualHex('', '')).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
  });

  it('returns false for same length with different characters', () => {
    expect(timingSafeEqualHex('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqualHex('123456', '023456')).toBe(false);
  });
});

describe('Telegram initData signature validation', () => {
  const TEST_BOT_TOKEN = '7123456789:AAHxyzABC1234567890abcdefghijklmnopqrst';
  const OTHER_BOT_TOKEN = '1234567890:BBHxyzABC1234567890abcdefghijklmnopqrst';

  const testUser: TelegramUser = {
    id: 12345678,
    first_name: 'Kirill',
    username: 'dungeon_master',
    language_code: 'ru',
  };

  const fixedNow = new Date('2026-09-29T12:00:00Z');
  const fixedNowSeconds = Math.floor(fixedNow.getTime() / 1000);

  it('accepts valid initData with matching bot token and recent auth_date', async () => {
    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: fixedNowSeconds - 100, // 100 seconds ago
      queryId: 'AAHdF6IQAAAAAN0XohD9vY8Z',
      startParam: 'join_secretcode12345',
    });

    const result = await validateTelegramInitData(rawInitData, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.data?.user.id).toBe(12345678);
    expect(result.data?.user.first_name).toBe('Kirill');
    expect(result.data?.user.username).toBe('dungeon_master');
    expect(result.data?.start_param).toBe('join_secretcode12345');
    expect(result.data?.query_id).toBe('AAHdF6IQAAAAAN0XohD9vY8Z');
  });

  it('rejects initData signed with a different bot token', async () => {
    const rawInitData = await createTestInitData(testUser, OTHER_BOT_TOKEN, {
      authDateSeconds: fixedNowSeconds - 60,
    });

    const result = await validateTelegramInitData(rawInitData, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Неверная цифровая подпись');
  });

  it('rejects initData when any parameter is tampered with', async () => {
    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: fixedNowSeconds - 60,
    });

    // Manually tamper the user id in query string without recalculating hash
    const tampered = rawInitData.replace('12345678', '99999999');

    const result = await validateTelegramInitData(tampered, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Неверная цифровая подпись');
  });

  it('rejects initData when hash is missing', async () => {
    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: fixedNowSeconds - 60,
      omitHash: true,
    });

    const result = await validateTelegramInitData(rawInitData, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Отсутствует хэш');
  });

  it('rejects initData when hash is corrupted', async () => {
    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: fixedNowSeconds - 60,
      invalidHash: true,
    });

    const result = await validateTelegramInitData(rawInitData, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Неверная цифровая подпись');
  });

  it('rejects initData older than 24 hours (86,400 seconds)', async () => {
    const expiredTimestamp = fixedNowSeconds - (24 * 60 * 60 + 10); // 24 hours and 10 seconds ago

    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: expiredTimestamp,
    });

    const result = await validateTelegramInitData(rawInitData, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('старше 24 часов');
  });

  it('rejects initData with auth_date too far in the future', async () => {
    const futureTimestamp = fixedNowSeconds + 120; // 2 minutes in the future

    const rawInitData = await createTestInitData(testUser, TEST_BOT_TOKEN, {
      authDateSeconds: futureTimestamp,
    });

    const result = await validateTelegramInitData(rawInitData, TEST_BOT_TOKEN, fixedNow);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('время из будущего');
  });

  it('rejects empty or non-string input', async () => {
    const result1 = await validateTelegramInitData('', TEST_BOT_TOKEN, fixedNow);
    expect(result1.isValid).toBe(false);
    expect(result1.error).toContain('Отсутствует строка initData');

    // @ts-expect-error test invalid type
    const result2 = await validateTelegramInitData(null, TEST_BOT_TOKEN, fixedNow);
    expect(result2.isValid).toBe(false);
  });

  it('calculates deterministic hashes', async () => {
    const str = 'auth_date=1727600000\nuser={"id":1}';
    const hash1 = await calculateInitDataHash(str, TEST_BOT_TOKEN);
    const hash2 = await calculateInitDataHash(str, TEST_BOT_TOKEN);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 in hex
  });
});
