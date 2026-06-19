import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { deviceLanguage } from '@/utils/locale';
import es from './locales/es.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['es', 'en', 'de', 'fr', 'pt'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Maps a raw locale code to a supported language, falling back to 'en'. */
function resolveLanguage(lang: string): SupportedLanguage {
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
    return lang as SupportedLanguage;
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: resolveLanguage(deviceLanguage()),
  fallbackLng: 'en',
  interpolation: {
    // React already escapes output — no double-escaping needed.
    escapeValue: false,
  },
});

/**
 * Switch the app language at runtime.
 * Called by the language picker (Phase 3) after persisting the preference.
 */
export function changeAppLanguage(lang: SupportedLanguage): void {
  void i18n.changeLanguage(lang);
}

export default i18n;
