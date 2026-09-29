import { describe, it, expect } from 'vitest';
import {
  generateInviteCode,
  isValidInviteCode,
  formatInviteLink,
  parseStartParam,
} from '../../shared/invites.ts';

describe('Invites utilities', () => {
  it('generates random codes of at least 16 characters using valid characters', () => {
    const code = generateInviteCode(24);
    expect(code.length).toBe(24);
    expect(isValidInviteCode(code)).toBe(true);

    const minCode = generateInviteCode(10); // should enforce minimum 16
    expect(minCode.length).toBe(16);
    expect(isValidInviteCode(minCode)).toBe(true);
  });

  it('validates invite code formatting', () => {
    expect(isValidInviteCode('abcdefgh12345678')).toBe(true);
    expect(isValidInviteCode('abcdefgh12345678_-')).toBe(true);
    expect(isValidInviteCode('too_short_12345')).toBe(false); // 15 chars
    expect(isValidInviteCode('has space 12345678')).toBe(false);
    expect(isValidInviteCode('invalid$char!12345678')).toBe(false);
  });

  it('formats telegram invite link properly without @ symbol', () => {
    const link = formatInviteLink('sklad_jli_bot', 'app', 'abcdef1234567890');
    expect(link).toBe('https://t.me/sklad_jli_bot/app?startapp=join_abcdef1234567890');

    const linkWithAt = formatInviteLink('@sklad_jli_bot', 'app', 'abcdef1234567890');
    expect(linkWithAt).toBe('https://t.me/sklad_jli_bot/app?startapp=join_abcdef1234567890');
  });

  it('parses valid start_param with join_ prefix', () => {
    const res = parseStartParam('join_abcdef1234567890');
    expect(res).not.toBeNull();
    expect(res?.type).toBe('join');
    expect(res?.code).toBe('abcdef1234567890');

    expect(parseStartParam(undefined)).toBeNull();
    expect(parseStartParam('')).toBeNull();
    expect(parseStartParam('other_param')).toBeNull();
    expect(parseStartParam('join_short')).toBeNull(); // code < 16 chars
  });
});
