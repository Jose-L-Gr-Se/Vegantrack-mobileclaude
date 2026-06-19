import type es from './locales/es.json';

/**
 * Augments i18next with the shape of es.json so that t('auth.login') is
 * type-checked and autocompleted. es.json is the source of truth; all other
 * locale files must mirror its structure.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof es;
    };
  }
}
