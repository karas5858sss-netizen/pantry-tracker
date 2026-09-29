/**
 * Lightweight pure i18n system for Pantry Tracker.
 * Supports Russian (ru), Spanish (es), and English (en).
 * Automatically resolves language from Telegram user language_code.
 */

export type SupportedLanguage = 'ru' | 'es' | 'en';

export const translations = {
  ru: {
    app_title: 'Pantry Tracker',
    app_subtitle: 'Учёт продуктов и сроков годности',
    mode_live: 'Камера',
    mode_photo: 'Фото',
    mode_manual: 'Вручную',

    // Scanner
    scanner_pause: 'Приостановить поток',
    scanner_resume: 'Возобновить поток',
    scanner_restart: 'Перезапустить камеру',
    scanner_scanned: 'Считано!',
    scanner_photo_prompt: 'Сделайте чёткий снимок штрихкода',
    scanner_photo_subtitle: 'Запасной режим при трудностях с живым видеопотоком',
    scanner_photo_btn: 'Снять фото',
    scanner_gallery_btn: 'Из галереи',
    scanner_not_found: 'Штрихкод на фотографии не обнаружен. Попробуйте сфотографировать ближе или ввести вручную.',
    scanner_error: 'Ошибка при обработке изображения. Попробуйте другое фото.',
    scanner_permission_denied: 'Доступ к камере отклонен. Разрешите доступ в настройках Telegram или переключитесь на режим фото.',
    scanner_device_not_found: 'Камера не найдена на этом устройстве.',
    scanner_unsupported: 'Камера не поддерживается в данном браузере или среде.',

    // EAN Validation
    ean_valid: 'Контрольная сумма верна по стандарту GS1',
    ean_invalid: 'Штрихкод считан, но не является стандартным EAN-13/EAN-8',
    ean_input_label: 'Цифры штрихкода (EAN-13 или EAN-8)',
    ean_input_placeholder: 'Например, 4006381333931',
    ean_input_empty: 'Введите штрихкод',
    ean_input_digits_only: 'Штрихкод должен содержать только цифры',
    ean_input_wrong_length: 'Неверная длина. Должно быть 8 (EAN-8) или 13 (EAN-13) цифр',
    ean_input_wrong_checksum: 'Неверная контрольная цифра',
    ean_apply: 'Применить штрихкод',
    ean_samples_title: 'Быстрые примеры для проверки:',

    // Session & Auth
    auth_checking: 'Авторизация в Telegram...',
    auth_not_allowed: 'Доступ закрыт: ваш Telegram ID не найден в списке разрешенных пользователей (allowed_users).',
    auth_limit_reached: 'Доступ закрыт: достигнут лимит проекта (максимум 10 пользователей).',
    auth_expired: 'Срок действия сессии Telegram истек. Пожалуйста, перезапустите приложение.',
    auth_invalid_signature: 'Ошибка проверки подлинности данных Telegram (неверная подпись).',
    auth_server_error: 'Ошибка соединения с сервером. Попробуйте позже.',

    // Pantries
    pantry_default_name: 'Мой склад',
    pantry_role_owner: 'Владелец',
    pantry_role_member: 'Участник',

    // Common
    btn_retry: 'Повторить',
    btn_copy: 'Копировать',
    copied: 'Скопировано!',
    history_title: 'История сканирований',
    history_clear: 'Очистить',
  },
  es: {
    app_title: 'Pantry Tracker',
    app_subtitle: 'Control de alimentos y fechas de caducidad',
    mode_live: 'Cámara',
    mode_photo: 'Foto',
    mode_manual: 'Manual',

    // Scanner
    scanner_pause: 'Pausar transmisión',
    scanner_resume: 'Reanudar transmisión',
    scanner_restart: 'Reiniciar cámara',
    scanner_scanned: '¡Escaneado!',
    scanner_photo_prompt: 'Toma una foto clara del código de barras',
    scanner_photo_subtitle: 'Modo de respaldo si hay problemas con el flujo de video en vivo',
    scanner_photo_btn: 'Tomar foto',
    scanner_gallery_btn: 'De la galería',
    scanner_not_found: 'No se detectó ningún código de barras en la foto. Intenta tomarla más de cerca o ingrésalo manualmente.',
    scanner_error: 'Error al procesar la imagen. Por favor, prueba con otra foto.',
    scanner_permission_denied: 'Acceso a la cámara denegado. Permite el acceso en los ajustes de Telegram o cambia al modo foto.',
    scanner_device_not_found: 'No se encontró ninguna cámara en este dispositivo.',
    scanner_unsupported: 'La cámara no es compatible con este navegador o entorno.',

    // EAN Validation
    ean_valid: 'Suma de control válida según el estándar GS1',
    ean_invalid: 'Código de barras leído, pero no es un EAN-13/EAN-8 estándar',
    ean_input_label: 'Dígitos del código de barras (EAN-13 o EAN-8)',
    ean_input_placeholder: 'Por ejemplo, 8410100000008',
    ean_input_empty: 'Ingresa el código de barras',
    ean_input_digits_only: 'El código de barras solo debe contener dígitos',
    ean_input_wrong_length: 'Longitud incorrecta. Debe tener 8 (EAN-8) o 13 (EAN-13) dígitos',
    ean_input_wrong_checksum: 'Dígito de control incorrecto',
    ean_apply: 'Aplicar código de barras',
    ean_samples_title: 'Ejemplos rápidos para probar:',

    // Session & Auth
    auth_checking: 'Autenticando en Telegram...',
    auth_not_allowed: 'Acceso denegado: tu ID de Telegram no está en la lista de usuarios permitidos (allowed_users).',
    auth_limit_reached: 'Acceso denegado: se ha alcanzado el límite del proyecto (máximo 10 usuarios).',
    auth_expired: 'La sesión de Telegram ha caducado. Por favor, reinicia la aplicación.',
    auth_invalid_signature: 'Error de verificación de firma de Telegram (firma inválida).',
    auth_server_error: 'Error de conexión con el servidor. Inténtalo más tarde.',

    // Pantries
    pantry_default_name: 'Mi despensa',
    pantry_role_owner: 'Propietario',
    pantry_role_member: 'Miembro',

    // Common
    btn_retry: 'Reintentar',
    btn_copy: 'Copiar',
    copied: '¡Copiado!',
    history_title: 'Historial de escaneos',
    history_clear: 'Limpiar',
  },
  en: {
    app_title: 'Pantry Tracker',
    app_subtitle: 'Home pantry and expiration date tracking',
    mode_live: 'Camera',
    mode_photo: 'Photo',
    mode_manual: 'Manual',

    // Scanner
    scanner_pause: 'Pause stream',
    scanner_resume: 'Resume stream',
    scanner_restart: 'Restart camera',
    scanner_scanned: 'Scanned!',
    scanner_photo_prompt: 'Take a clear photo of the barcode',
    scanner_photo_subtitle: 'Fallback mode when live video stream is unavailable',
    scanner_photo_btn: 'Take photo',
    scanner_gallery_btn: 'From gallery',
    scanner_not_found: 'No barcode detected in the photo. Try taking it closer or enter digits manually.',
    scanner_error: 'Error processing image. Please try another photo.',
    scanner_permission_denied: 'Camera access denied. Please grant access in Telegram settings or switch to photo mode.',
    scanner_device_not_found: 'Camera not found on this device.',
    scanner_unsupported: 'Camera is not supported in this browser or environment.',

    // EAN Validation
    ean_valid: 'Checksum valid according to GS1 standard',
    ean_invalid: 'Barcode detected, but not a standard EAN-13/EAN-8',
    ean_input_label: 'Barcode digits (EAN-13 or EAN-8)',
    ean_input_placeholder: 'For example, 4006381333931',
    ean_input_empty: 'Enter barcode',
    ean_input_digits_only: 'Barcode must contain only digits',
    ean_input_wrong_length: 'Incorrect length. Must be 8 (EAN-8) or 13 (EAN-13) digits',
    ean_input_wrong_checksum: 'Incorrect check digit',
    ean_apply: 'Apply barcode',
    ean_samples_title: 'Quick samples for testing:',

    // Session & Auth
    auth_checking: 'Authenticating with Telegram...',
    auth_not_allowed: 'Access denied: your Telegram ID is not in the whitelist (allowed_users).',
    auth_limit_reached: 'Access denied: project limit reached (maximum 10 users).',
    auth_expired: 'Telegram session expired. Please reopen the app.',
    auth_invalid_signature: 'Telegram signature validation failed (invalid signature).',
    auth_server_error: 'Server connection error. Please try again later.',

    // Pantries
    pantry_default_name: 'My Pantry',
    pantry_role_owner: 'Owner',
    pantry_role_member: 'Member',

    // Common
    btn_retry: 'Retry',
    btn_copy: 'Copy',
    copied: 'Copied!',
    history_title: 'Scan history',
    history_clear: 'Clear',
  },
} as const;

export type TranslationKey = keyof typeof translations.ru;

/**
 * Detects supported language from Telegram language_code.
 */
export function detectLanguage(telegramLang?: string): SupportedLanguage {
  if (!telegramLang) return 'ru';
  const code = telegramLang.toLowerCase().slice(0, 2);
  if (code === 'es') return 'es';
  if (code === 'en') return 'en';
  return 'ru';
}

/**
 * Retrieves translated string by key with fallback to Russian.
 */
export function t(lang: SupportedLanguage, key: TranslationKey): string {
  const dict = translations[lang] || translations.ru;
  return dict[key] || translations.ru[key] || key;
}
