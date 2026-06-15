/**
 * Preferencia de tema: 'system' (sigue al SO), 'light' o 'dark'.
 * Se persiste en SQLite (kv) para que la elección sobreviva al cierre. El
 * `useTheme()` lee esta preferencia y, si está en 'system', cae al
 * useColorScheme nativo.
 */
import { create } from 'zustand';
import { kvGet, kvSet } from '@/db/database';

export type ThemePreference = 'system' | 'light' | 'dark';

const KV_KEY = 'theme:preference';

interface ThemeState {
  preference: ThemePreference;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPreference: (p: ThemePreference) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await kvGet<ThemePreference>(KV_KEY);
      if (stored === 'system' || stored === 'light' || stored === 'dark') {
        set({ preference: stored, hydrated: true });
        return;
      }
    } catch {
      // primera ejecución sin preferencia guardada
    }
    set({ hydrated: true });
  },

  setPreference: async (p) => {
    set({ preference: p });
    await kvSet(KV_KEY, p);
  },
}));
