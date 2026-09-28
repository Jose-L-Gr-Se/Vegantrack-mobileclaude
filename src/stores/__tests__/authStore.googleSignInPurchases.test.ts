/**
 * Auditoría del ciclo de vida del entitlement Pro — `signIn()`, `signUp()` e
 * `initialize()` (sesión ya persistida) llaman todos a
 * `usePurchasesStore.getState().init(userId)` justo después de establecer la
 * sesión, para que RevenueCat quede configurado y el `customerInfo` en vivo
 * (fuente 1 de `hasProEntitlement`, ver `utils/proEntitlement.ts`) esté
 * disponible desde el primer instante. `signInWithGoogle()` establece la
 * sesión exactamente igual (PKCE vía `exchangeCodeForSession` o el flujo
 * implicit vía `setSession`) pero nunca llamaba a `init()` en ninguno de los
 * dos caminos de éxito — ni tampoco el listener de `onAuthStateChange` en el
 * evento `SIGNED_IN`, que sólo actualiza `session`/`user` y llama a
 * `fetchProfile()`.
 *
 * Consecuencia real: un usuario que entra con Google nunca tiene
 * `Purchases.configure()` llamado en toda la sesión de la app (es el ÚNICO
 * sitio que lo hace, en `purchasesStore.init()`) — el paywall se queda sin
 * catálogo real (`ProModal` depende de `offerings`/`customerInfo` del store,
 * que nunca se cargan) y cualquier intento de compra o de "restaurar
 * compras" opera sobre un SDK de RevenueCat sin configurar. Si compró Pro
 * por Google Play, su `customerInfo` local nunca refleja esa compra — sólo
 * convergería si/cuando el webhook de RevenueCat actualizara
 * `profiles.subscription_tier` por separado, dejando una ventana real en la
 * que un usuario Pro (por Google Play) que entró con Google ve/usa Free.
 */
import type { Profile } from '@/types';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSetSession = jest.fn();

let profileResult: { data: unknown; error: unknown } = { data: null, error: null };

const mockFrom = jest.fn((..._args: unknown[]) => ({
  select: () => ({
    eq: () => ({
      abortSignal: () => ({
        single: () => Promise.resolve(profileResult),
      }),
    }),
  }),
}));

const mockKvGet = jest.fn();
const mockKvSet = jest.fn();
const mockFunctionsInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  AUTH_TIMEOUT_MS: 6000,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    functions: { invoke: (...args: unknown[]) => mockFunctionsInvoke(...args) },
  },
}));

jest.mock('@/db/database', () => ({
  kvGet: (...args: unknown[]) => mockKvGet(...args),
  kvSet: (...args: unknown[]) => mockKvSet(...args),
  mirrorList: jest.fn(async () => []),
  mirrorUpsert: jest.fn(async () => undefined),
  mirrorMarkSynced: jest.fn(async () => undefined),
  mirrorMarkDeleted: jest.fn(async () => undefined),
  mirrorRemove: jest.fn(async () => undefined),
  mirrorPending: jest.fn(async () => []),
  mirrorReplaceDay: jest.fn(async () => undefined),
}));

const mockPurchasesInit = jest.fn();
const mockPurchasesReset = jest.fn().mockResolvedValue(undefined);
jest.mock('@/stores/purchasesStore', () => ({
  usePurchasesStore: {
    getState: () => ({
      init: (...args: unknown[]) => mockPurchasesInit(...args),
      reset: (...args: unknown[]) => mockPurchasesReset(...args),
    }),
  },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/lib/analytics', () => ({
  track: jest.fn(),
  trackFirstFoodLoggedOnce: jest.fn(async () => false),
}));
jest.mock('@/notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 20,
  getReminderHour: jest.fn(async () => null),
  getReminderOfferShown: jest.fn(async () => false),
  markReminderOfferShown: jest.fn(async () => undefined),
  onMealLogged: jest.fn(async () => undefined),
  scheduleDailyReminder: jest.fn(),
  disableDailyReminder: jest.fn(async () => undefined),
  resyncDailyReminder: jest.fn(),
}));

jest.mock('expo-linking', () => ({ createURL: (p: string) => `vegantrack://${p}` }));
const mockOpenAuthSessionAsync = jest.fn();
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args) }));

import type { useAuthStore as UseAuthStoreType } from '@/stores/authStore';

let useAuthStore: typeof UseAuthStoreType;

function loadFreshAuthStore(): typeof UseAuthStoreType {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@/stores/authStore').useAuthStore;
}

const PROFILE = (id: string): Profile => ({ id, calorie_target: 2000 }) as unknown as Profile;

/** Simula lo que hace supabase-js internamente: notificar a los listeners de
 *  `onAuthStateChange` con la nueva sesión ANTES de que la promesa de
 *  `exchangeCodeForSession`/`setSession` resuelva — mismo mecanismo del que
 *  ya depende `signIn()`/`signUp()` hoy para que `fetchProfile()` encuentre
 *  `get().user` ya asignado. */
function fireSignedIn(userId: string) {
  const listener = mockOnAuthStateChange.mock.calls[0]?.[0];
  const session = {
    access_token: 'tok',
    refresh_token: 'rtok',
    expires_at: Date.now() / 1000 + 3600,
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  };
  listener?.('SIGNED_IN', session);
  return session;
}

beforeEach(() => {
  jest.clearAllMocks();
  profileResult = { data: null, error: null };
  mockKvGet.mockResolvedValue(null);
  mockFunctionsInvoke.mockResolvedValue({ data: null, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  useAuthStore = loadFreshAuthStore();
});

describe('signInWithGoogle — debe inicializar purchasesStore igual que signIn/signUp (auditoría del entitlement Pro)', () => {
  it('flujo PKCE (?code=...): llama a usePurchasesStore.init() con el id del usuario recién autenticado', async () => {
    await useAuthStore.getState().initialize(); // registra el listener de onAuthStateChange

    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/auth' }, error: null });
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'vegantrack://auth/callback?code=abc123',
    });
    mockExchangeCodeForSession.mockImplementation(async () => {
      const session = fireSignedIn('user-google-1');
      return { data: { user: session.user, session }, error: null };
    });
    profileResult = { data: PROFILE('user-google-1'), error: null };

    const { error } = await useAuthStore.getState().signInWithGoogle();

    expect(error).toBeNull();
    // Éste es el hallazgo: sin el fix, `mockPurchasesInit` nunca se llama —
    // RevenueCat se queda sin `Purchases.configure()` durante toda la sesión.
    expect(mockPurchasesInit).toHaveBeenCalledWith('user-google-1');
  });

  it('flujo implicit (#access_token=...): también llama a usePurchasesStore.init()', async () => {
    await useAuthStore.getState().initialize();

    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/auth' }, error: null });
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'vegantrack://auth/callback#access_token=tok123&refresh_token=rtok123',
    });
    mockSetSession.mockImplementation(async () => {
      const session = fireSignedIn('user-google-2');
      return { data: { user: session.user, session }, error: null };
    });
    profileResult = { data: PROFILE('user-google-2'), error: null };

    const { error } = await useAuthStore.getState().signInWithGoogle();

    expect(error).toBeNull();
    expect(mockPurchasesInit).toHaveBeenCalledWith('user-google-2');
  });
});
