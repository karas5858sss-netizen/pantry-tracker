import { describe, it, expect } from 'vitest';
import { translations, detectLanguage, t, type SupportedLanguage } from '../../shared/i18n.ts';

describe('i18n Consistency Guard Tests', () => {
  const ruKeys = Object.keys(translations.ru).sort();
  const esKeys = Object.keys(translations.es).sort();
  const enKeys = Object.keys(translations.en).sort();

  it('ensures ru has non-empty keys', () => {
    expect(ruKeys.length).toBeGreaterThan(0);
  });

  it('ensures all translation keys in Russian exist in Spanish and English without discrepancies', () => {
    // Check es matches ru
    const missingInEs = ruKeys.filter((k) => !(k in translations.es));
    const extraInEs = esKeys.filter((k) => !(k in translations.ru));

    expect(
      missingInEs,
      `Spanish translations are missing keys present in Russian: ${missingInEs.join(', ')}`
    ).toEqual([]);

    expect(
      extraInEs,
      `Spanish translations have extra keys not present in Russian: ${extraInEs.join(', ')}`
    ).toEqual([]);

    // Check en matches ru
    const missingInEn = ruKeys.filter((k) => !(k in translations.en));
    const extraInEn = enKeys.filter((k) => !(k in translations.ru));

    expect(
      missingInEn,
      `English translations are missing keys present in Russian: ${missingInEn.join(', ')}`
    ).toEqual([]);

    expect(
      extraInEn,
      `English translations have extra keys not present in Russian: ${extraInEn.join(', ')}`
    ).toEqual([]);
  });

  it('ensures no empty string translations exist', () => {
    const langs: SupportedLanguage[] = ['ru', 'es', 'en'];
    for (const lang of langs) {
      const dict = translations[lang];
      for (const [key, value] of Object.entries(dict)) {
        expect(
          value.trim().length,
          `Key "${key}" in language "${lang}" must not be empty`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('detectLanguage properly resolves language codes', () => {
    expect(detectLanguage('ru')).toBe('ru');
    expect(detectLanguage('ru-RU')).toBe('ru');
    expect(detectLanguage('es')).toBe('es');
    expect(detectLanguage('es-ES')).toBe('es');
    expect(detectLanguage('en')).toBe('en');
    expect(detectLanguage('en-US')).toBe('en');
    expect(detectLanguage('de')).toBe('ru'); // fallback
    expect(detectLanguage(undefined)).toBe('ru');
  });

  it('t function returns translation or key fallback', () => {
    expect(t('ru', 'app_title')).toBe('Pantry Tracker');
    expect(t('es', 'mode_live')).toBe('Cámara');
    expect(t('en', 'mode_manual')).toBe('Manual');
  });
});
