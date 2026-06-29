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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ChunkedSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
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
