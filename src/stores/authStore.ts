/**
 * Sesión y perfil. El perfil se cachea en SQLite (kv) para que la app
 * arranque mostrando datos aunque no haya red.
 *
 * Auditoría del bloqueo de auth/perfil (ver diseño aprobado): `authPhase` es
 * la ÚNICA fuente de verdad sobre en qué estado de arranque está la app —
 * ni `initialize()`, ni el listener de `onAuthStateChange`, ni ningún otro
 * sitio deben mantener un segundo booleano paralelo (`initialized`,
 * `profileResolved`, etc.) que pueda desincronizarse de `authPhase`.
 */
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase, AUTH_TIMEOUT_MS } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import { usePurchasesStore } from '@/stores/purchasesStore';
import {
  sanitizeProfilePatch,
  type EditableProfileFields,
} from '@/utils/profilePatch';
import type { Profile } from '@/types';

/**
 * Estados de arranque de la sesión/perfil:
 *  - `loading`: todavía no sabemos nada (spinner inicial).
 *  - `authenticated_profile_loaded`: sesión confirmada por red + perfil
 *     confirmado por red.
 *  - `authenticated_cached_profile`: o bien sesión confirmada pero el
 *     perfil no se pudo confirmar por red (se usa el cacheado, puede ser
 *     `null` si nunca hubo uno); o bien la sesión en sí no se pudo
 *     confirmar por un error TRANSITORIO (`isAuthRetryableFetchError`) y
 *     hay un perfil cacheado del último usuario conocido (`user`/`session`
 *     quedan `null` en este segundo caso: nunca se finge una sesión que no
 *     se ha confirmado).
 *  - `unauthenticated`: sin sesión real (nunca hubo, cierre de sesión
 *     explícito, o un error de auth NO reintentable como un token
 *     revocado). Nunca se llega aquí desde un problema de red.
 *  - `recoverable_error`: la sesión no se pudo confirmar por un error
 *     transitorio Y no hay ningún perfil cacheado al que recurrir.
 */
export type AuthPhase =
  | 'loading'
  | 'authenticated_profile_loaded'
  | 'authenticated_cached_profile'
  | 'unauthenticated'
  | 'recoverable_error';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  authPhase: AuthPhase;
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
  /**
   * Actualiza el perfil del usuario.
   *
   * El tipo excluye a propósito las columnas de suscripción y de identidad
   * (ver `@/utils/profilePatch`): el entitlement Pro sólo lo escribe el webhook
   * de RevenueCat con `service_role`. Intentar pasarlas es un error de
   * compilación, y en tiempo de ejecución se descartan antes de la petición.
   */
  updateProfile: (patch: Partial<EditableProfileFields>) => Promise<{ error: string | null }>;
}

const profileKvKey = (userId: string) => `profile:${userId}`;

/**
 * Último usuario para el que se confirmó un perfil por red — la única
 * pieza nueva de estado persistido de esta ronda. NO es un token ni un dato
 * sensible (un uuid), y su único uso es poder recuperar `profileKvKey` en
 * `authenticated_cached_profile` cuando `getSession()` falla por un error
 * transitorio y no hay ningún `user.id` confirmado con el que consultar el
 * caché.
 *
 * Ciclo de vida (ver diseño aprobado, apartado 2):
 *  - Se ESCRIBE únicamente cuando `fetchProfile()` confirma un perfil real
 *    por red (mismo punto donde ya se cachea `profileKvKey`) — nunca desde
 *    el camino cacheado ni desde un `getSession()` fallido. Así se
 *    garantiza que sólo apunta a un usuario con un perfil cacheado válido.
 *  - Se ELIMINA en `signOut()` explícito (y en el evento `SIGNED_OUT`, por
 *    si la sesión se invalida por otra vía). Un `initialize()` posterior a
 *    un logout limpio, sin red, no encuentra nada que leer.
 *  - NUNCA se consulta cuando el error de `getSession()` no es
 *    transitorio (`!isAuthRetryableFetchError`) ni cuando no hay error en
 *    absoluto — esas ramas van directas a `unauthenticated`, sin mirar la
 *    caché de nadie.
 */
const LAST_USER_ID_KEY = 'last_user_id';

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

export const useAuthStore = create<AuthState>((set, get) => {
  // Se suscribe una única vez por instancia del store (defensivo: hoy
  // `initialize()` sólo se invoca una vez desde `RootNavigator`, pero esta
  // guarda evita un segundo listener si eso cambiara).
  let authListenerRegistered = false;

  function registerAuthListener() {
    if (authListenerRegistered) return;
    authListenerRegistered = true;

    supabase.auth.onAuthStateChange((event, newSession) => {
      // `INITIAL_SESSION` repite, internamente, la misma comprobación que
      // ya hizo `initialize()` con su propio `getSession()` (verificado en
      // @supabase/auth-js: `onAuthStateChange` dispara `_emitInitialSession`,
      // que vuelve a ejecutar `__loadSession()`). Si esa segunda
      // comprobación también fallase por red, este evento llegaría con
      // `newSession: null` — y tratarlo como logout pisaría la decisión ya
      // correcta que `initialize()` tomó un instante antes (caso G de la
      // auditoría). Por eso se ignora explícitamente para `authPhase`.
      if (event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        void kvSet(LAST_USER_ID_KEY, null);
        set({ session: null, user: null, profile: null, authPhase: 'unauthenticated' });
        return;
      }

      if (event === 'SIGNED_IN') {
        set({ session: newSession, user: newSession?.user ?? null });
        if (newSession?.user) void get().fetchProfile();
        return;
      }

      // TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY: mismo usuario,
      // sólo se actualizan session/user — nunca reinician el perfil ni
      // `authPhase` (comportamiento ya correcto hoy, sin cambios).
      set({ session: newSession, user: newSession?.user ?? null });
    });
  }

  return {
    user: null,
    session: null,
    profile: null,
    authPhase: 'loading',

    initialize: async () => {
      const { data, error } = await supabase.auth.getSession();
      const session = data.session;

      if (session) {
        set({ session, user: session.user });
        usePurchasesStore.getState().init(session.user.id);
        // Perfil cacheado primero (arranque instantáneo offline), luego red.
        const cached = await kvGet<Profile>(profileKvKey(session.user.id));
        if (cached) set({ profile: cached });
        await get().fetchProfile(); // decide authenticated_profile_loaded vs authenticated_cached_profile
      } else if (!error) {
        // Sin error: no hay sesión real (nunca hubo login, o un logout /
        // token inválido ya la purgó). Nunca se llega aquí por un problema
        // de red — ver la rama de abajo para eso.
        set({ session: null, user: null, profile: null, authPhase: 'unauthenticated' });
      } else if (isAuthRetryableFetchError(error)) {
        // Había una sesión guardada localmente que no se pudo confirmar
        // por red (timeout o fallo de conexión) — nunca un logout real.
        // "Red caída ≠ logout": se intenta recuperar el último perfil
        // conocido en vez de expulsar al usuario a la pantalla de login.
        const lastUserId = await kvGet<string>(LAST_USER_ID_KEY);
        const cachedProfile = lastUserId ? await kvGet<Profile>(profileKvKey(lastUserId)) : null;
        if (cachedProfile) {
          set({ profile: cachedProfile, authPhase: 'authenticated_cached_profile' });
        } else {
          set({ authPhase: 'recoverable_error' });
        }
      } else {
        // Error de auth NO reintentable (p.ej. token revocado): nunca se
        // usa la caché aquí, pase lo que pase con `last_user_id`.
        set({ session: null, user: null, profile: null, authPhase: 'unauthenticated' });
      }

      registerAuthListener();
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
      // Fire-and-forget: never blocks registration if email fails
      void supabase.functions.invoke('send-email', {
        method: 'POST',
        body: { type: 'signup' },
      });
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
      void kvSet(LAST_USER_ID_KEY, null);
      set({ user: null, session: null, profile: null, authPhase: 'unauthenticated' });
    },

    deleteAccount: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return { error: 'No hay sesión activa' };
      try {
        const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
        if (error) return { error: error.message };
        await supabase.auth.signOut();
        void kvSet(LAST_USER_ID_KEY, null);
        set({ user: null, session: null, profile: null, authPhase: 'unauthenticated' });
        return { error: null };
      } catch (e: any) {
        return { error: e?.message ?? 'Error de red' };
      }
    },

    fetchProfile: async () => {
      const user = get().user;
      if (!user) return;

      // Timeout abortable — ver AUTH_TIMEOUT_MS en @/lib/supabase. Una
      // consulta por PK a `profiles` es pequeña y rápida: no hay motivo
      // para que se cuelgue más que una operación de sesión. A diferencia
      // del lado de auth, Postgrest NUNCA reintenta una petición abortada
      // (verificado en @supabase/postgrest-js), así que este timeout es
      // exacto, no acumulable.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .abortSignal(controller.signal)
          .single();
        if (!error && data) {
          const profile = data as Profile;
          set({ profile, authPhase: 'authenticated_profile_loaded' });
          void kvSet(profileKvKey(user.id), profile);
          void kvSet(LAST_USER_ID_KEY, user.id);
        } else {
          // Red, error del servidor, o timeout: nos quedamos con lo que ya
          // hubiera en memoria (el caché ya cargado antes de esta llamada,
          // o `null` si nunca hubo uno) y lo marcamos como no confirmado
          // por red — nunca se descarta un perfil ya cargado por un fallo
          // posterior de refresco.
          set({ authPhase: 'authenticated_cached_profile' });
        }
      } finally {
        clearTimeout(timer);
      }
    },

    updateProfile: async (patch) => {
      const user = get().user;
      if (!user) return { error: 'No hay sesión' };
      const current = get().profile;

      // Red de seguridad en el borde: nunca enviamos columnas que el servidor va
      // a rechazar (subscription_tier y compañía). La protección real está en
      // Postgres; esto sólo evita peticiones condenadas al 42501 y mantiene la
      // UI optimista libre de un estado Pro que el usuario no tiene.
      const { patch: safePatch, removed } = sanitizeProfilePatch(patch);
      if (removed.length > 0 && __DEV__) {
        console.warn(
          `[authStore] updateProfile: columnas ignoradas (sólo el servidor puede escribirlas): ${removed.join(', ')}`
        );
      }
      if (Object.keys(safePatch).length === 0) return { error: null };

      // Optimista: la UI refleja el cambio al instante
      if (current) set({ profile: { ...current, ...safePatch } });

      const { data, error } = await supabase
        .from('profiles')
        .update({ ...safePatch, updated_at: new Date().toISOString() })
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
  };
});
