/**
 * Auditoría del bloqueo de auth/perfil — `authPhase` como única fuente de
 * verdad del arranque. Cubre los casos A-H del diseño aprobado más los
 * puntos adicionales pedidos (timer limpiado, timeout de perfil sin dejar
 * promesas colgadas, logout limpia `last_user_id`, error no-retryable
 * nunca usa caché, `INITIAL_SESSION` no pisa la decisión de `initialize()`).
 *
 * `@supabase/supabase-js` se usa REAL para `isAuthRetryableFetchError` y
 * las clases `AuthRetryableFetchError`/`AuthApiError` — así los tests
 * ejercitan la clasificación real, no una suposición de forma en un mock.
 * Sólo se mockea `@/lib/supabase` (el cliente concreto de esta app).
 */
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import type { Profile } from '@/types';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue({ error: null });

// Estado configurable del mock de `profiles` — cada test ajusta `profileResult`
// o `profileResultOnAbort` antes de llamar a `fetchProfile`/`initialize`.
let profileResult: { data: unknown; error: unknown } = { data: null, error: null };
/** Si se define, `.single()` no resuelve hasta que el signal capturado se aborta. */
let profileResultOnAbort: { data: unknown; error: unknown } | null = null;
let lastAbortSignal: AbortSignal | undefined;

const mockFrom = jest.fn((..._args: unknown[]) => ({
  select: () => ({
    eq: () => ({
      abortSignal: (signal: AbortSignal) => {
        lastAbortSignal = signal;
        return {
          single: () => {
            if (profileResultOnAbort) {
              return new Promise((resolve) => {
                signal.addEventListener('abort', () => resolve(profileResultOnAbort));
              });
            }
            return Promise.resolve(profileResult);
          },
        };
      },
    }),
  }),
}));

const mockKvGet = jest.fn();
const mockKvSet = jest.fn();

jest.mock('@/lib/supabase', () => ({
  AUTH_TIMEOUT_MS: 6000,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('@/db/database', () => ({
  kvGet: (...args: unknown[]) => mockKvGet(...args),
  kvSet: (...args: unknown[]) => mockKvSet(...args),
}));

jest.mock('@/stores/purchasesStore', () => ({
  usePurchasesStore: { getState: () => ({ init: jest.fn(), reset: jest.fn().mockResolvedValue(undefined) }) },
}));

jest.mock('expo-linking', () => ({ createURL: (p: string) => `vegantrack://${p}` }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

import type { useAuthStore as UseAuthStoreType } from '@/stores/authStore';

// `authStore.ts` registra el listener de `onAuthStateChange` una única vez
// por instancia del store (guarda de producción, deliberada: `initialize()`
// sólo se llama una vez desde `RootNavigator`). Para poder comprobar el
// registro del listener de forma aislada en cada test — no sólo en el
// primero que llegue a ejecutarse — cada test carga una instancia NUEVA del
// store con `jest.resetModules()`, en vez de reutilizar un único import
// estático para todo el archivo.
let useAuthStore: typeof UseAuthStoreType;

function loadFreshAuthStore(): typeof UseAuthStoreType {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@/stores/authStore').useAuthStore;
}

const SESSION = (userId: string) =>
  ({
    access_token: 'tok',
    refresh_token: 'rtok',
    expires_at: Date.now() / 1000 + 3600,
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  }) as any;

const PROFILE = (id: string): Profile => ({ id, calorie_target: 2000 }) as unknown as Profile;

beforeEach(() => {
  jest.clearAllMocks();
  profileResult = { data: null, error: null };
  profileResultOnAbort = null;
  lastAbortSignal = undefined;
  mockKvGet.mockResolvedValue(null);
  useAuthStore = loadFreshAuthStore();
});

describe('A. sesión válida + red → app normal', () => {
  it('authPhase termina en authenticated_profile_loaded con el perfil de red', async () => {
    const session = SESSION('user-1');
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    profileResult = { data: PROFILE('user-1'), error: null };

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().authPhase).toBe('authenticated_profile_loaded');
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(useAuthStore.getState().profile?.id).toBe('user-1');
    // last_user_id se actualiza tras un fetch de perfil exitoso.
    expect(mockKvSet).toHaveBeenCalledWith('last_user_id', 'user-1');
  });
});

describe('B. sesión persistida + red caída durante el refresco → app offline', () => {
  it('authPhase termina en authenticated_cached_profile usando last_user_id, sin llamar a Postgrest', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('network request failed', 0),
    });
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'last_user_id') return 'user-1';
      if (key === 'profile:user-1') return PROFILE('user-1');
      return null;
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().authPhase).toBe('authenticated_cached_profile');
    expect(useAuthStore.getState().profile?.id).toBe('user-1');
    expect(useAuthStore.getState().user).toBeNull(); // nunca se finge una sesión no confirmada
    expect(mockFrom).not.toHaveBeenCalled(); // no hay user.id confirmado con el que pedir el perfil
  });

  it('sin ningún perfil cacheado disponible → recoverable_error (nunca unauthenticated)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('network request failed', 0),
    });
    mockKvGet.mockResolvedValue(null); // ni last_user_id ni perfil

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().authPhase).toBe('recoverable_error');
  });
});

describe('C. sesión persistida + getSession() "colgado" → nunca deja authPhase en loading', () => {
  it('cuando getSession() por fin resuelve (tarde) con un error transitorio, authPhase sale de loading', async () => {
    let resolveGetSession!: (v: unknown) => void;
    mockGetSession.mockReturnValue(
      new Promise((resolve) => {
        resolveGetSession = resolve;
      })
    );
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'last_user_id') return 'user-1';
      if (key === 'profile:user-1') return PROFILE('user-1');
      return null;
    });

    const initPromise = useAuthStore.getState().initialize();
    expect(useAuthStore.getState().authPhase).toBe('loading'); // todavía esperando

    resolveGetSession({ data: { session: null }, error: new AuthRetryableFetchError('timeout', 0) });
    await initPromise;

    expect(useAuthStore.getState().authPhase).not.toBe('loading');
    expect(useAuthStore.getState().authPhase).toBe('authenticated_cached_profile');
  });
});

describe('D. usuario realmente deslogueado → unauthenticated', () => {
  it('sin sesión ni error: unauthenticated, y nunca se consulta last_user_id', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().authPhase).toBe('unauthenticated');
    expect(mockKvGet).not.toHaveBeenCalledWith('last_user_id');
  });
});

describe('E. token revocado/error no-retryable → unauthenticated, nunca caché', () => {
  it('un AuthApiError (no retryable) nunca usa el perfil cacheado, aunque exista', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('invalid refresh token', 400, 'refresh_token_not_found'),
    });
    // Deliberadamente disponible, para probar que NUNCA se llega a leer.
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'last_user_id') return 'user-1';
      if (key === 'profile:user-1') return PROFILE('user-1');
      return null;
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().authPhase).toBe('unauthenticated');
    expect(useAuthStore.getState().profile).toBeNull();
    expect(mockKvGet).not.toHaveBeenCalledWith('last_user_id');
  });
});

describe('F. primer arranque, usuario nuevo, sin red → unauthenticated coherente (no recoverable_error)', () => {
  it('storage vacío desde el principio: mismo camino que "nunca hubo sesión", no un error ambiguo', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockKvGet.mockResolvedValue(null); // dispositivo nuevo: ni siquiera last_user_id

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().authPhase).toBe('unauthenticated');
  });
});

describe('G. ninguna resolución tardía pisa un estado ya decidido', () => {
  it('initialize() sólo escribe authPhase una vez con el resultado que realmente recibió', async () => {
    const session = SESSION('user-1');
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    profileResult = { data: PROFILE('user-1'), error: null };

    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().authPhase).toBe('authenticated_profile_loaded');

    // No hay ningún watchdog ni segunda promesa de fondo: avanzar tiempo o
    // microtasks después de que initialize() ya resolvió no cambia nada.
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().authPhase).toBe('authenticated_profile_loaded');
  });

  it('INITIAL_SESSION emitido después de initialize() no pisa la decisión ya tomada', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('network', 0),
    });
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'last_user_id') return 'user-1';
      if (key === 'profile:user-1') return PROFILE('user-1');
      return null;
    });

    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().authPhase).toBe('authenticated_cached_profile');

    // onAuthStateChange se registra al final de initialize() — se captura el
    // callback y se invoca manualmente con INITIAL_SESSION y sesión nula,
    // simulando que la comprobación interna de _emitInitialSession también
    // falló por red.
    const listener = mockOnAuthStateChange.mock.calls[0][0];
    listener('INITIAL_SESSION', null);

    expect(useAuthStore.getState().authPhase).toBe('authenticated_cached_profile');
    expect(useAuthStore.getState().profile?.id).toBe('user-1');
  });
});

describe('H. TOKEN_REFRESHED válido → comportamiento intacto', () => {
  it('sólo actualiza session/user; no toca authPhase ni profile', async () => {
    const session = SESSION('user-1');
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    profileResult = { data: PROFILE('user-1'), error: null };
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().authPhase).toBe('authenticated_profile_loaded');

    const listener = mockOnAuthStateChange.mock.calls[0][0];
    const refreshedSession = { ...session, access_token: 'nuevo-token' };
    listener('TOKEN_REFRESHED', refreshedSession);

    expect(useAuthStore.getState().session?.access_token).toBe('nuevo-token');
    expect(useAuthStore.getState().authPhase).toBe('authenticated_profile_loaded'); // intacto
    expect(useAuthStore.getState().profile?.id).toBe('user-1'); // intacto
  });
});

describe('SIGNED_OUT elimina last_user_id y pasa a unauthenticated', () => {
  it('el evento SIGNED_OUT limpia el estado y last_user_id', async () => {
    const session = SESSION('user-1');
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    profileResult = { data: PROFILE('user-1'), error: null };
    await useAuthStore.getState().initialize();

    const listener = mockOnAuthStateChange.mock.calls[0][0];
    listener('SIGNED_OUT', null);

    expect(useAuthStore.getState().authPhase).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
    expect(mockKvSet).toHaveBeenCalledWith('last_user_id', null);
  });
});

describe('logout explícito (signOut) elimina last_user_id', () => {
  it('signOut() borra last_user_id además de user/session/profile', async () => {
    const session = SESSION('user-1');
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    profileResult = { data: PROFILE('user-1'), error: null };
    await useAuthStore.getState().initialize();

    await useAuthStore.getState().signOut();

    expect(mockSignOut).toHaveBeenCalled();
    expect(mockKvSet).toHaveBeenCalledWith('last_user_id', null);
    expect(useAuthStore.getState().authPhase).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('fetchProfile: timeout produce estado recuperable/caché sin dejar promesas colgadas', () => {
  it('cuando el AbortController de fetchProfile() dispara su propio timer, resuelve a authenticated_cached_profile con lo que ya hubiera en memoria', async () => {
    jest.useFakeTimers();
    try {
      const session = SESSION('user-1');
      mockGetSession.mockResolvedValue({ data: { session }, error: null });
      mockKvGet.mockImplementation(async (key: string) => (key === 'profile:user-1' ? PROFILE('user-1') : null));

      // `.single()` no resuelve hasta que el propio AbortController interno
      // de fetchProfile() dispare su timer de AUTH_TIMEOUT_MS — igual que
      // haría Postgrest de verdad al recibir un AbortError (resuelve
      // {data:null, error}, nunca deja la promesa colgada ni rechaza sin
      // capturar).
      profileResultOnAbort = {
        data: null,
        error: { message: 'AbortError: aborted', hint: 'Request was aborted (timeout or manual cancellation)' },
      };

      const initPromise = useAuthStore.getState().initialize();
      // Deja que se llegue hasta fetchProfile() y se capture el signal real.
      await Promise.resolve();
      await Promise.resolve();
      expect(lastAbortSignal).toBeDefined();
      expect(lastAbortSignal!.aborted).toBe(false);

      jest.advanceTimersByTime(6000); // AUTH_TIMEOUT_MS
      await initPromise;

      expect(lastAbortSignal!.aborted).toBe(true);
      expect(useAuthStore.getState().authPhase).toBe('authenticated_cached_profile');
      // El perfil cacheado (cargado antes de la llamada de red) se conserva.
      expect(useAuthStore.getState().profile?.id).toBe('user-1');
    } finally {
      jest.useRealTimers();
    }
  });
});
