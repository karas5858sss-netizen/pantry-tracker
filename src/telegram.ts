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
    webkitAudioContext?: typeof AudioContext;
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

let audioCtx: AudioContext | null = null;

/**
 * Standard warehouse/retail scanner confirmation beep (880Hz, 90ms).
 */
export function playScanBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    // Clear 880Hz beep
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.09);
  } catch (e) {
    console.debug('Audio beep omitted:', e);
  }
}

export function triggerHaptic(type: 'success' | 'warning' | 'error' | 'light' | 'heavy' = 'success') {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
    try {
      if (type === 'light' || type === 'heavy') {
        window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
      } else {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred(type);
      }
    } catch {
      // Haptics not available on this platform
    }
  } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      if (type === 'success' || type === 'heavy') navigator.vibrate?.([60, 30, 60]);
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
