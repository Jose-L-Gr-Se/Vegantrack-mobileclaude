/**
 * Sesión y perfil. El perfil se cachea en SQLite (kv) para que la app
 * arranque mostrando datos aunque no haya red.
 */
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import type { Profile } from '@/types';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  initialized: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<{ error: string | null }>;
}

const profileKvKey = (userId: string) => `profile:${userId}`;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  initialized: false,

  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    set({ session, user: session?.user ?? null });

    supabase.auth.onAuthStateChange((_event, newSession) => {
      set({ session: newSession, user: newSession?.user ?? null });
      if (!newSession) set({ profile: null });
    });

    if (session?.user) {
      // Perfil cacheado primero (arranque instantáneo offline), luego red.
      const cached = await kvGet<Profile>(profileKvKey(session.user.id));
      if (cached) set({ profile: cached });
      await get().fetchProfile();
    }
    set({ initialized: true });
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    await get().fetchProfile();
    return { error: null };
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    await get().fetchProfile();
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, profile: null });
  },

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (!error && data) {
      const profile = data as Profile;
      set({ profile });
      void kvSet(profileKvKey(user.id), profile);
    }
  },

  updateProfile: async (patch) => {
    const user = get().user;
    if (!user) return { error: 'No hay sesión' };
    const current = get().profile;
    // Optimista: la UI refleja el cambio al instante
    if (current) set({ profile: { ...current, ...patch } });

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      if (current) set({ profile: current });
      return { error: error.message };
    }
    const profile = data as Profile;
    set({ profile });
    void kvSet(profileKvKey(user.id), profile);
    return { error: null };
  },
}));
