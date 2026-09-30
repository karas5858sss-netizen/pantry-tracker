/**
 * Pure domain logic for expiration reminders, timezone calculation,
 * stage categorization, and Telegram HTML message formatting.
 */

import { t, type SupportedLanguage } from './i18n.ts';

export type ReminderStage = 1 | 2 | 3;

export interface ReminderItem {
  id: string;
  name: string;
  quantity: number;
  expiration_date: string; // YYYY-MM-DD
  barcode?: string | null;
  stage: ReminderStage;
  daysRemaining: number;
}

export interface UserReminderProfile {
  reminder_hour: number;
  reminders_enabled: boolean;
  timezone: string;
  can_write_pm: boolean;
}

/**
 * Escapes characters for Telegram HTML parse_mode:
 * & -> &amp;
 * < -> &lt;
 * > -> &gt;
 * " -> &quot;
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats a Date object to YYYY-MM-DD in the specified timezone.
 * Falls back to Europe/Moscow on invalid timezone strings.
 */
export function getUserLocalDate(now: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  } catch {
    const fallback = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fallback.format(now);
  }
}

/**
 * Returns current hour (0..23) in the specified timezone.
 * Handles Intl 24-hour wrap-around (e.g. 24 -> 0).
 */
export function getUserLocalHour(now: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'Europe/Moscow',
      hour: 'numeric',
      hour12: false,
    });
    const parsed = parseInt(formatter.format(now), 10);
    return isNaN(parsed) ? 0 : parsed % 24;
  } catch {
    const fallback = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: 'numeric',
      hour12: false,
    });
    const parsed = parseInt(fallback.format(now), 10);
    return isNaN(parsed) ? 0 : parsed % 24;
  }
}

/**
 * Calculates calendar day difference between expiration date and current local date:
 * daysRemaining = expirationDate - userLocalDate.
 * Using Date.UTC prevents daylight saving time (DST) calculation errors.
 */
export function calculateDaysRemaining(expirationDate: string, userLocalDate: string): number {
  const [expY, expM, expD] = expirationDate.split('-').map(Number);
  const [curY, curM, curD] = userLocalDate.split('-').map(Number);
  const utcExp = Date.UTC(expY, expM - 1, expD);
  const utcCur = Date.UTC(curY, curM - 1, curD);
  const diffMs = utcExp - utcCur;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Categorizes daysRemaining into reminder stages:
 * - Stage 1 (Скоро истекает): 1 or 2 days left
 * - Stage 2 (Истекает сегодня): 0 days left
 * - Stage 3 (Просрочено): -1 to -7 days (expired within the last 7 days)
 * Returns null if outside reminder windows.
 */
export function categorizeReminderStage(daysRemaining: number): ReminderStage | null {
  if (daysRemaining === 1 || daysRemaining === 2) {
    return 1;
  }
  if (daysRemaining === 0) {
    return 2;
  }
  if (daysRemaining < 0 && daysRemaining >= -7) {
    return 3;
  }
  return null;
}

/**
 * Checks whether user should receive reminders at the given reference time `now`.
 */
export function isUserReminderDue(user: UserReminderProfile, now: Date): boolean {
  if (!user.reminders_enabled || !user.can_write_pm) {
    return false;
  }
  const currentHour = getUserLocalHour(now, user.timezone);
  return currentHour === user.reminder_hour;
}

/**
 * Formats a single Telegram HTML notification message for a pantry.
 * Limits items display to maxItems (default 20), appending an overflow line if exceeded.
 */
export function formatPantryReminderHtml(
  pantryName: string,
  items: ReminderItem[],
  lang: SupportedLanguage = 'ru',
  maxItems: number = 20
): string {
  if (items.length === 0) {
    return '';
  }

  // Group items by stage
  const expired = items.filter((i) => i.stage === 3);
  const today = items.filter((i) => i.stage === 2);
  const soon = items.filter((i) => i.stage === 1);

  // Build sorted list of items for display: expired first, then today, then soon
  const orderedItems: ReminderItem[] = [...expired, ...today, ...soon];
  const totalCount = orderedItems.length;
  const displayedItems = orderedItems.slice(0, maxItems);
  const overflowCount = totalCount - displayedItems.length;

  const titleText = t(lang, 'reminder_title').replace('{name}', escapeHtml(pantryName));
  const lines: string[] = [`🔔 <b>${titleText}</b>\n`];

  // Group displayed items into stages for clear visual sections
  const dispExpired = displayedItems.filter((i) => i.stage === 3);
  const dispToday = displayedItems.filter((i) => i.stage === 2);
  const dispSoon = displayedItems.filter((i) => i.stage === 1);

  const unitPcs = t(lang, 'reminder_unit_pcs');

  if (dispExpired.length > 0) {
    lines.push(`<b>${t(lang, 'reminder_expired_section')}</b>`);
    for (const item of dispExpired) {
      lines.push(`• <b>${escapeHtml(item.name)}</b> (${item.quantity} ${unitPcs}) — ${item.expiration_date}`);
    }
    lines.push('');
  }

  if (dispToday.length > 0) {
    lines.push(`<b>${t(lang, 'reminder_today_section')}</b>`);
    for (const item of dispToday) {
      lines.push(`• <b>${escapeHtml(item.name)}</b> (${item.quantity} ${unitPcs}) — ${item.expiration_date}`);
    }
    lines.push('');
  }

  if (dispSoon.length > 0) {
    lines.push(`<b>${t(lang, 'reminder_soon_section')}</b>`);
    for (const item of dispSoon) {
      lines.push(`• <b>${escapeHtml(item.name)}</b> (${item.quantity} ${unitPcs}) — ${item.expiration_date}`);
    }
    lines.push('');
  }

  if (overflowCount > 0) {
    const moreText = t(lang, 'reminder_more_items').replace('{count}', String(overflowCount));
    lines.push(`<i>${moreText}</i>`);
  }

  return lines.join('\n').trim();
}
