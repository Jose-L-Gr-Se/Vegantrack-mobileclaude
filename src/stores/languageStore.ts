import { create } from 'zustand';
import { kvGet, kvSet } from '@/db/database';
import { SUPPORTED_LANGUAGES, changeAppLanguage, type SupportedLanguage } from '@/i18n';

const KV_KEY = 'lang:preference';

interface LanguageState {
  language: SupportedLanguage;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: 'en',
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await kvGet<SupportedLanguage>(KV_KEY);
      if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
        changeAppLanguage(stored);
        set({ language: stored, hydrated: true });
        return;
      }
    } catch {
      // no stored preference
    }
    set({ hydrated: true });
  },

  setLanguage: async (lang) => {
    changeAppLanguage(lang);
    set({ language: lang });
    await kvSet(KV_KEY, lang);
  },
}));
