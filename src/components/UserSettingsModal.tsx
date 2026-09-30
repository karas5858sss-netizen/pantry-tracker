import React, { useState, useEffect } from 'react';
import type { SessionUser } from '../api.ts';
import { updateUserSettings, updateWriteAccess, sendTestReminder } from '../api.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { triggerHaptic } from '../telegram.ts';

interface UserSettingsModalProps {
  isOpen: boolean;
  user: SessionUser;
  lang: SupportedLanguage;
  onClose: () => void;
  onUserUpdated: (updatedUser: SessionUser) => void;
}

const COMMON_TIMEZONES = [
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Europe/Madrid', label: 'Мадрид / Испания (CET/CEST)' },
  { value: 'Europe/London', label: 'Лондон (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Берлин / Париж (CET/CEST)' },
  { value: 'America/New_York', label: 'Нью-Йорк (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'Лос-Анджелес (PST/PDT)' },
  { value: 'UTC', label: 'UTC' },
];

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  user,
  lang,
  onClose,
  onUserUpdated,
}) => {
  const [remindersEnabled, setRemindersEnabled] = useState(user.reminders_enabled);
  const [reminderHour, setReminderHour] = useState(user.reminder_hour ?? 9);
  const [timezone, setTimezone] = useState(user.timezone || 'Europe/Moscow');
  const [canWritePm, setCanWritePm] = useState(user.can_write_pm);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingReminder, setIsTestingReminder] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRemindersEnabled(user.reminders_enabled);
      setReminderHour(user.reminder_hour ?? 9);
      setTimezone(user.timezone || 'Europe/Moscow');
      setCanWritePm(user.can_write_pm);
      setErrorMsg(null);
      setTestSuccessMessage(null);
      setSaveSuccess(false);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleSendTestReminder = async () => {
    setIsTestingReminder(true);
    setErrorMsg(null);
    setTestSuccessMessage(null);
    triggerHaptic('light');

    const res = await sendTestReminder();
    setIsTestingReminder(false);

    if (res.data?.success) {
      triggerHaptic('success');
      setCanWritePm(true);
      setTestSuccessMessage(res.data.message || t(lang, 'settings_test_reminder_success'));
      setTimeout(() => setTestSuccessMessage(null), 5000);
    } else {
      triggerHaptic('error');
      setErrorMsg(res.error?.error || 'Не удалось отправить тестовое напоминание');
    }
  };

  const handleRequestPmAccess = () => {
    triggerHaptic('light');
    const tgWebApp = typeof window !== 'undefined'
      ? (window.Telegram?.WebApp as unknown as { requestWriteAccess?: (cb: (allowed: boolean) => void) => void })
      : undefined;

    if (tgWebApp?.requestWriteAccess) {
      try {
        tgWebApp.requestWriteAccess(async (allowed: boolean) => {
          if (allowed) {
            triggerHaptic('success');
            await updateWriteAccess(true);
            setCanWritePm(true);
          } else {
            triggerHaptic('warning');
          }
        });
        return;
      } catch {
        // Fallback below
      }
    }

    // Fallback: open bot in Telegram chat
    const botUser = (window as any).Telegram?.WebApp?.initDataUnsafe?.bot?.username || 'sklad_jli_bot';
    const tgApp = typeof window !== 'undefined' ? (window.Telegram?.WebApp as any) : undefined;
    if (tgApp?.openTelegramLink) {
      tgApp.openTelegramLink(`https://t.me/${botUser}?start=settings`);
    } else {
      window.open(`https://t.me/${botUser}?start=settings`, '_blank');
    }
  };

  const handleAutoDetectTimezone = () => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) {
        setTimezone(detected);
        triggerHaptic('light');
      }
    } catch {
      // Ignore
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);

    const res = await updateUserSettings({
      reminders_enabled: remindersEnabled,
      reminder_hour: reminderHour,
      timezone: timezone.trim(),
    });

    setIsSaving(false);

    if (res.data?.user) {
      triggerHaptic('success');
      setSaveSuccess(true);
      onUserUpdated(res.data.user);
      setTimeout(() => {
        onClose();
      }, 700);
    } else {
      triggerHaptic('error');
      setErrorMsg(res.error?.error || 'Не удалось сохранить настройки');
    }
  };

  // Preset hours for fast selection
  const quickHours = [8, 9, 12, 18, 20];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-tg-bg text-tg-text rounded-t-3xl sm:rounded-2xl border border-tg-hint/20 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
        {/* Header */}
        <div className="p-4 border-b border-tg-hint/15 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <div>
              <h3 className="font-bold text-sm text-tg-text">{t(lang, 'settings_title')}</h3>
              <p className="text-[11px] text-tg-hint">ID: {user.telegram_id}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-tg-secondary flex items-center justify-center text-tg-hint hover:text-tg-text active:scale-95 transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* 1. Toggle Reminders Enabled */}
          <div className="flex items-center justify-between p-3.5 bg-tg-secondary rounded-2xl border border-tg-hint/15">
            <div>
              <div className="font-semibold text-xs text-tg-text flex items-center gap-1.5">
                <span>🔔</span>
                <span>{t(lang, 'settings_reminders_enabled')}</span>
              </div>
              <div className="text-[11px] text-tg-hint mt-0.5">
                {remindersEnabled ? t(lang, 'settings_reminders_on') : t(lang, 'settings_reminders_off')}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setRemindersEnabled(!remindersEnabled);
                triggerHaptic('light');
              }}
              className={`w-12 h-7 rounded-full p-1 transition duration-200 ease-in-out ${
                remindersEnabled ? 'bg-emerald-500' : 'bg-tg-hint/30'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-xs transform transition duration-200 ease-in-out ${
                  remindersEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* 2. Bot Access Warning / Status */}
          {!canWritePm ? (
            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-xs space-y-2">
              <div className="flex items-start gap-2 text-amber-500 font-semibold">
                <span className="text-base">⚠️</span>
                <div>
                  <p>{t(lang, 'settings_bot_blocked_warn')}</p>
                  <p className="text-[11px] text-tg-hint font-normal mt-0.5">
                    Telegram требует подтверждения диалога перед отправкой уведомлений
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRequestPmAccess}
                className="w-full py-2 px-3 bg-amber-500 text-black font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-98"
              >
                <span>💬</span>
                <span>{t(lang, 'settings_open_bot')}</span>
              </button>
            </div>
          ) : (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-[11px] text-emerald-500 font-medium">
              <span>✓</span>
              <span>{t(lang, 'settings_pm_access_active')}</span>
            </div>
          )}

          {/* Test reminder action button */}
          <div className="p-3 bg-tg-secondary/70 rounded-2xl border border-tg-hint/15 space-y-2">
            <button
              type="button"
              disabled={isTestingReminder}
              onClick={handleSendTestReminder}
              className="w-full py-2.5 px-3 bg-tg-button/10 hover:bg-tg-button/15 text-tg-button border border-tg-button/25 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-98 disabled:opacity-50"
            >
              <span className={isTestingReminder ? 'animate-spin' : ''}>
                {isTestingReminder ? '⏳' : '🔔'}
              </span>
              <span>
                {isTestingReminder
                  ? t(lang, 'settings_test_reminder_sending')
                  : t(lang, 'settings_test_reminder_btn')}
              </span>
            </button>
            {testSuccessMessage && (
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-[11px] text-emerald-500 font-medium text-center">
                ✓ {testSuccessMessage}
              </div>
            )}
          </div>

          {/* 3. Reminder Hour Picker */}
          <div className="p-3.5 bg-tg-secondary rounded-2xl border border-tg-hint/15 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-tg-text flex items-center gap-1.5">
                <span>⏰</span>
                <span>{t(lang, 'settings_reminder_hour')}</span>
              </label>
              <span className="text-xs font-mono font-bold text-tg-link bg-tg-button/10 px-2 py-0.5 rounded-lg">
                {String(reminderHour).padStart(2, '0')}:00
              </span>
            </div>

            {/* Quick chips */}
            <div className="flex flex-wrap gap-1.5">
              {quickHours.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setReminderHour(h);
                    triggerHaptic('light');
                  }}
                  className={`px-2.5 py-1 rounded-xl text-xs font-medium transition ${
                    reminderHour === h
                      ? 'bg-tg-button text-tg-button font-bold shadow-xs'
                      : 'bg-tg-bg text-tg-hint hover:text-tg-text'
                  }`}
                >
                  {String(h).padStart(2, '0')}:00
                </button>
              ))}
            </div>

            {/* Slider or custom select */}
            <div className="pt-1">
              <input
                type="range"
                min="0"
                max="23"
                step="1"
                value={reminderHour}
                onChange={(e) => {
                  setReminderHour(parseInt(e.target.value, 10));
                  triggerHaptic('light');
                }}
                className="w-full accent-tg-button h-2 bg-tg-bg rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-tg-hint font-mono mt-1 px-1">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
            </div>
          </div>

          {/* 4. Timezone Picker */}
          <div className="p-3.5 bg-tg-secondary rounded-2xl border border-tg-hint/15 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-tg-text flex items-center gap-1.5">
                <span>🌍</span>
                <span>{t(lang, 'settings_timezone')}</span>
              </label>
              <button
                type="button"
                onClick={handleAutoDetectTimezone}
                className="text-[11px] text-tg-link hover:underline font-medium"
              >
                Определить
              </button>
            </div>

            <select
              value={COMMON_TIMEZONES.some((tz) => tz.value === timezone) ? timezone : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  setTimezone(e.target.value);
                  triggerHaptic('light');
                }
              }}
              className="w-full p-2.5 bg-tg-bg border border-tg-hint/20 rounded-xl text-xs text-tg-text font-medium outline-hidden focus:border-tg-link"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label} ({tz.value})
                </option>
              ))}
              {!COMMON_TIMEZONES.some((tz) => tz.value === timezone) && (
                <option value="custom">Другой ({timezone})</option>
              )}
            </select>

            <div className="text-[10px] text-tg-hint font-mono px-1">
              Текущий часовой пояс: {timezone}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-500">
              {errorMsg}
            </div>
          )}

          {saveSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-xs text-emerald-500 text-center font-medium">
              ✓ {t(lang, 'settings_saved')}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-tg-hint/15 bg-tg-secondary/30">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-3 bg-tg-button text-tg-button font-bold rounded-2xl text-xs shadow-md transition active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>{t(lang, 'settings_saving')}</span>
              </>
            ) : (
              <span>💾 {t(lang, 'settings_save')}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
