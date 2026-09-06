/**
 * Cliente Supabase para React Native.
 *
 * La sesión (tokens) se guarda en el almacenamiento seguro del sistema
 * (Android Keystore vía expo-secure-store). SecureStore limita cada valor a
 * ~2 KB, así que troceamos los valores grandes en chunks.
 *
 * flowType 'pkce': flujo recomendado para apps nativas. El login con Google
 * devuelve un `?code=` que intercambiamos por sesión (exchangeCodeForSession),
 * mucho más fiable en móvil que el antiguo flujo implicit (#access_token).
 */
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const CHUNK_SIZE = 1800;

function chunkKey(key: string, i: number): string {
  return `${key}__chunk_${i}`;
}

// SecureStore solo admite [A-Za-z0-9._-] en las claves.
function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const ChunkedSecureStore = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = sanitizeKey(rawKey);
    const countStr = await SecureStore.getItemAsync(key);
    if (countStr === null) return null;
    const count = Number(countStr);
    if (!Number.isFinite(count) || count <= 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(rawKey: string, value: string): Promise<void> {
    const key = sanitizeKey(rawKey);
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(key, String(chunks.length));
    await Promise.all(chunks.map((c, i) => SecureStore.setItemAsync(chunkKey(key, i), c)));
  },
  async removeItem(rawKey: string): Promise<void> {
    const key = sanitizeKey(rawKey);
    const countStr = await SecureStore.getItemAsync(key);
    const count = Number(countStr ?? 0);
    await SecureStore.deleteItemAsync(key);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const isSupabaseConfigured =
  !supabaseUrl.includes('placeholder') && !supabaseAnonKey.includes('placeholder');

/**
 * Auditoría del bloqueo de auth/perfil: timeout de red para el endpoint de
 * auth (`getSession`/refresco de token/login) — la única familia de
 * llamadas que puede dejar el arranque entero de la app colgado (verificado
 * leyendo @supabase/auth-js: ni `getSession()` ni `_callRefreshToken()`
 * tienen ningún timeout propio).
 *
 * Deliberadamente NO se aplica a Postgrest/Functions vía este mismo cauce:
 * `exportDiaryCsv` (sin `.limit()` para Pro) y `fetchRecentFoods` (200 filas)
 * son consultas legítimamente más lentas que una operación de sesión, y no
 * deben cortarse por un timeout pensado para peticiones pequeñas. El timeout
 * de `fetchProfile`/`updateProfile` (una sola fila por PK) se aplica aparte,
 * por llamada, con `.abortSignal()` — ver `authStore.ts`.
 */
export const AUTH_TIMEOUT_MS = 6000;

// Exportado sólo para poder testear `timeoutFetch` sin adivinar/hardcodear
// la URL base real (que depende de las variables de entorno).
export const AUTH_PATH_PREFIX = `${supabaseUrl}/auth/v1/`;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url; // Request
}

/**
 * `fetch` de sustitución para el cliente de Supabase. Sólo actúa sobre
 * peticiones al endpoint de auth (`/auth/v1/...`) — cualquier otra URL
 * (Postgrest, Functions) se reenvía a `fetch` sin tocar, íntegra.
 *
 * Verificado en @supabase/auth-js (`lib/fetch.js`): un `AbortError` lanzado
 * aquí se reclasifica siempre como `AuthRetryableFetchError`, y
 * `getSession()`/`_callRefreshToken()` lo resuelven como `{data:null,
 * error}` — nunca como una promesa colgada ni una excepción sin capturar.
 * Por eso basta con abortar de verdad: el propio SDK ya sabe qué hacer con
 * ese error.
 *
 * Conserva cualquier `AbortSignal` externo que ya viniera en `init.signal`
 * en vez de sobrescribirlo: si el llamador aborta el suyo, o si nuestro
 * timeout salta primero, cualquiera de los dos cancela la petición real.
 * Usa `AbortController` + `setTimeout` manual (no `AbortSignal.timeout()`,
 * de soporte no garantizado en Hermes) y limpia siempre el temporizador,
 * tanto en éxito como en error, para no dejar timers sueltos.
 */
export function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!requestUrl(input).startsWith(AUTH_PATH_PREFIX)) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  const externalSignal = init?.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ChunkedSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: { fetch: timeoutFetch },
});

// Refresco automático de tokens solo mientras la app está en primer plano.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

/** Base de la PWA/API Vercel (checkout de Stripe, landing). */
export const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://vegantrack.app';
