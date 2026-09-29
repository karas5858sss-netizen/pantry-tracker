/**
 * Telegram WebApp API helpers with safe browser fallbacks.
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        colorScheme: 'light' | 'dark';
        themeParams: Record<string, string>;
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          auth_date?: number;
          hash?: string;
          start_param?: string;
        };
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        isExpanded?: boolean;
        viewportHeight?: number;
        viewportStableHeight?: number;
      };
    };
  }
}

export function initTelegramApp() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    try {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    } catch (err) {
      console.warn('Failed to initialize Telegram WebApp SDK:', err);
    }
  }
}

export function triggerHaptic(type: 'success' | 'warning' | 'error' | 'light' = 'success') {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
    try {
      if (type === 'light') {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
      } else {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred(type);
      }
    } catch {
      // Haptics not available on this platform
    }
  } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      if (type === 'success') navigator.vibrate?.([40, 30, 40]);
      else if (type === 'error') navigator.vibrate?.([100, 50, 100]);
      else navigator.vibrate?.(40);
    } catch {
      // Vibration not permitted
    }
  }
}

export function isTelegramClient(): boolean {
  return typeof window !== 'undefined' && !!window.Telegram?.WebApp?.initData;
}
