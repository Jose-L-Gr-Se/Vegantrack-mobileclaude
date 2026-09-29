/**
 * Auditoría de instrumentación del funnel — hallazgo B.4 (ya detectado en la
 * auditoría de paywall) hecho ahora estrictamente necesario: `init()` se
 * llama sin guard desde varios puntos de `authStore.ts` (arranque, signIn,
 * signUp, y cada reintento de `AuthRecoveryScreen`). Sin el guard, cada
 * llamada repetida para el mismo usuario registraba OTRO listener de
 * RevenueCat — inofensivo antes, pero ahora falsearía `subscription_expired`
 * (un evento real contado varias veces).
 *
 * `jest.resetModules()` + `require` dinámico por test: el guard es una
 * variable de módulo (`initializedUserId`), así que cada test necesita una
 * instancia fresca del store — y, para que las aserciones miren al MISMO
 * mock que usa esa instancia fresca, también hay que re-requerir
 * `react-native-purchases` y `@/lib/analytics` después de cada
 * `resetModules()` (si no, se comparan mocks de registros distintos y todo
 * sale en 0 llamadas). Mismo patrón que `authStore.authPhase.test.ts`.
 */
// `purchasesStore.ts` sólo importa `{ Platform }` de 'react-native' — un
// mock mínimo y completo del paquete (no `jest.requireActual`, que arrastra
// TurboModules nativos no disponibles aquí) basta, y sobrevive a
// `jest.resetModules()` porque el registro de `jest.mock()` no se limpia con
// resetModules, sólo las instancias de los módulos ya cargados.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue({ entitlements: { active: {} } }),
    addCustomerInfoUpdateListener: jest.fn(),
    logOut: jest.fn().mockResolvedValue(undefined),
  },
  LOG_LEVEL: { DEBUG: 'DEBUG' },
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

function loadFresh() {
  jest.resetModules();
  return {
    usePurchasesStore: require('@/stores/purchasesStore').usePurchasesStore,
    Purchases: require('react-native-purchases').default,
    track: require('@/lib/analytics').track,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_test_key';
});

afterEach(() => {
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = ORIGINAL_ENV;
});

describe('purchasesStore.init — guard de re-entrada', () => {
  it('llamar init() dos veces con el MISMO userId sólo configura/registra el listener una vez', () => {
    const { usePurchasesStore, Purchases } = loadFresh();
    usePurchasesStore.getState().init('user-1');
    usePurchasesStore.getState().init('user-1'); // p. ej. un segundo reintento de AuthRecoveryScreen

    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.addCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
  });

  it('llamar init() con un userId DISTINTO tras reset() sí reconfigura', async () => {
    const { usePurchasesStore, Purchases } = loadFresh();
    usePurchasesStore.getState().init('user-1');
    await usePurchasesStore.getState().reset();
    usePurchasesStore.getState().init('user-2');

    expect(Purchases.configure).toHaveBeenCalledTimes(2);
    expect(Purchases.addCustomerInfoUpdateListener).toHaveBeenCalledTimes(2);
  });
});

describe('purchasesStore — subscription_expired', () => {
  it('transición de Pro activo a inactivo dispara subscription_expired exactamente una vez', () => {
    const { usePurchasesStore, Purchases, track } = loadFresh();
    usePurchasesStore.getState().init('user-1');

    const listener = Purchases.addCustomerInfoUpdateListener.mock.calls[0][0];

    // Primer evento: entitlement activo (p. ej. tras una compra) — nunca hubo
    // uno activo antes, así que NO debe contarse como expiración.
    listener({ entitlements: { active: { pro: {} } } });
    expect(track).not.toHaveBeenCalledWith('subscription_expired');

    // Segundo evento: el entitlement desaparece — activo→inactivo, sí es
    // una expiración real.
    listener({ entitlements: { active: {} } });
    expect(track).toHaveBeenCalledWith('subscription_expired');
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('permanecer inactivo (nunca hubo Pro) no dispara subscription_expired', () => {
    const { usePurchasesStore, Purchases, track } = loadFresh();
    usePurchasesStore.getState().init('user-1');
    const listener = Purchases.addCustomerInfoUpdateListener.mock.calls[0][0];

    listener({ entitlements: { active: {} } });
    listener({ entitlements: { active: {} } });

    expect(track).not.toHaveBeenCalledWith('subscription_expired');
  });

  it('con el guard activo (mismo usuario, dos init()), sólo hay UN listener registrado', () => {
    const { usePurchasesStore, Purchases } = loadFresh();
    usePurchasesStore.getState().init('user-1');
    usePurchasesStore.getState().init('user-1');

    expect(Purchases.addCustomerInfoUpdateListener.mock.calls).toHaveLength(1);
  });
});
