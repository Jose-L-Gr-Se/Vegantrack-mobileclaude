/**
 * Sesión y perfil. El perfil se cachea en SQLite (kv) para que la app
 * arranque mostrando datos aunque no haya red.
 */
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import { usePurchasesStore } from '@/stores/purchasesStore';
import type { Profile } from '@/types';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  initialized: boolean;
  // true cuando ya hemos intentado cargar el perfil del usuario actual.
  // Evita el "flash" del diario mientras el perfil aún viaja por la red.
  profileResolved: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  confirmPasswordReset: (
    email: string,
    token: string,
    newPassword: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  fetchProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<{ error: string | null }>;
}

const profileKvKey = (userId: string) => `profile:${userId}`;

/** Extrae los parámetros de una URL de retorno, tanto de query (?) como de fragmento (#). */
function parseRedirectParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const grab = (segment: string) => {
    for (const pair of segment.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = eq >= 0 ? pair.slice(0, eq) : pair;
      const val = eq >= 0 ? pair.slice(eq + 1) : '';
      try {
        out[decodeURIComponent(key)] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  };
  if (queryIndex >= 0) grab(url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined));
  if (hashIndex >= 0) grab(url.slice(hashIndex + 1));
  return out;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  initialized: false,
  profileResolved: false,

  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    set({ session, user: session?.user ?? null });

    supabase.auth.onAuthStateChange((_event, newSession) => {
      set({ session: newSession, user: newSession?.user ?? null });
      // Al cerrar sesión limpiamos el perfil y reseteamos el gate, para que
      // un futuro login vuelva a esperar a que su perfil cargue.
      if (!newSession) set({ profile: null, profileResolved: false });
    });

    if (session?.user) {
      usePurchasesStore.getState().init(session.user.id);
      // Perfil cacheado primero (arranque instantáneo offline), luego red.
      const cached = await kvGet<Profile>(profileKvKey(session.user.id));
      if (cached) set({ profile: cached });
      await get().fetchProfile();
    }
    set({ initialized: true });
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    await get().fetchProfile();
    if (data.user) usePurchasesStore.getState().init(data.user.id);
    return { error: null };
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    await get().fetchProfile();
    if (data.user) usePurchasesStore.getState().init(data.user.id);
    return { error: null };
  },

  signInWithGoogle: async () => {
    try {
      // El redirect vuelve a la app por el scheme vegantrack://
      // En Supabase Dashboard → Auth → URL Configuration → Redirect URLs
      // debes añadir:  vegantrack://auth/callback
      const redirectTo = Linking.createURL('auth/callback');

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) return { error: error.message };
      if (!data.url) return { error: 'No se pudo obtener la URL de autenticación' };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { error: null }; // usuario canceló, sin error
      }
      if (result.type !== 'success') {
        return { error: 'Autenticación cancelada' };
      }

      const params = parseRedirectParams(result.url);

      // Si el proveedor devolvió un error explícito, muéstralo.
      if (params.error || params.error_description) {
        return { error: params.error_description || params.error };
      }

      // Flujo PKCE (por defecto): llega ?code=... y se intercambia por sesión.
      if (params.code) {
        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(params.code);
        if (exchErr) return { error: exchErr.message };
        await get().fetchProfile();
        return { error: null };
      }

      // Flujo implicit (compatibilidad): llegan los tokens en el fragmento #.
      if (params.access_token) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token ?? '',
        });
        if (sessErr) return { error: sessErr.message };
        await get().fetchProfile();
        return { error: null };
      }

      return { error: 'No se recibieron credenciales de Google' };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return { error: error.message };
    return { error: null };
  },

  confirmPasswordReset: async (email, token, newPassword) => {
    // El código de 6 dígitos del email crea una sesión temporal (type recovery)…
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'recovery',
    });
    if (verifyErr) return { error: verifyErr.message };
    // …y con esa sesión fijamos la nueva contraseña.
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) return { error: updateErr.message };
    await get().fetchProfile();
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    await usePurchasesStore.getState().reset();
    set({ user: null, session: null, profile: null, profileResolved: false });
  },

  deleteAccount: async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { error: 'No hay sesión activa' };
    try {
      const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
      if (error) return { error: error.message };
      await supabase.auth.signOut();
      set({ user: null, session: null, profile: null });
      return { error: null };
    } catch (e: any) {
      return { error: e?.message ?? 'Error de red' };
    }
  },

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;
    try {
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
    } finally {
      // Pase lo que pase (éxito, error o falta de red) consideramos resuelto
      // el intento, para no dejar la app atascada en el spinner inicial.
      set({ profileResolved: true });
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
