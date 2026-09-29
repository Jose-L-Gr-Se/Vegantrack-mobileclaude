/**
 * Fase 2 del P1 de sincronización — listener de `AppState` en el punto
 * global (`RootNavigator`, vía `appStateSync.ts`).
 *
 * Se testea la función aislada, sin montar el árbol de navegación completo
 * (Ionicons, las 8 pantallas, etc.): `attachAppStateFlushListener` no
 * reimplementa nada de `flushPending`, sólo decide CUÁNDO llamarlo, así que
 * basta con simular la transición de `AppState` y comprobar qué se invoca.
 * `flushPending` se mockea aquí a propósito (jest.fn) — el mutex real de la
 * Fase 1 se ejercita aparte, con los stores reales, en
 * `appStateSync.mutex.test.ts`.
 */
let registeredCallback: ((state: string) => void) | undefined;
const mockRemove = jest.fn();
const mockAddEventListener = jest.fn((_event: string, cb: (state: string) => void) => {
  registeredCallback = cb;
  return { remove: mockRemove };
});
// `currentState` se lee UNA vez al suscribirse (`attachAppStateFlushListener`
// guarda `AppState.currentState` como estado inicial). Necesita ser mutable
// desde los tests sin depender de qué objeto concreto devuelva el Proxy en
// cada acceso — de ahí la variable + getter, en vez de una propiedad fija.
let mockCurrentAppState = 'active';

// Sólo se sustituye `AppState` — el resto del módulo real se conserva SIN
// evaluarlo (Proxy, no spread): `react-native/index.js` expone la mayoría de
// sus exports como getters perezosos (p. ej. FlatList → DevMenu, un
// TurboModule no registrado en este entorno de test), así que un `{ ...actual }`
// los dispara TODOS de golpe y rompe el arranque. El Proxy reenvía cualquier
// acceso que no sea `AppState` sin tocarlo.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'AppState') {
        return {
          ...target.AppState,
          get currentState() {
            return mockCurrentAppState;
          },
          addEventListener: (...args: [string, (state: string) => void]) => mockAddEventListener(...args),
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
});

const mockAuthGetState = jest.fn();
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuthGetState() } }));

const mockDiaryFlushPending = jest.fn();
jest.mock('@/stores/diaryStore', () => ({
  useDiaryStore: { getState: () => ({ flushPending: mockDiaryFlushPending }) },
}));

const mockWeightFlushPending = jest.fn();
jest.mock('@/stores/weightStore', () => ({
  useWeightStore: { getState: () => ({ flushPending: mockWeightFlushPending }) },
}));

import { attachAppStateFlushListener } from '@/navigation/appStateSync';

const USER = { id: 'user-1' };

beforeEach(() => {
  jest.clearAllMocks();
  registeredCallback = undefined;
  mockCurrentAppState = 'active';
  mockAuthGetState.mockReturnValue({ user: USER });
  mockDiaryFlushPending.mockResolvedValue(undefined);
  mockWeightFlushPending.mockResolvedValue(undefined);
});

describe('attachAppStateFlushListener (Fase 2 del P1 de sync)', () => {
  it('1. registra el listener de AppState al llamarlo', () => {
    attachAppStateFlushListener();
    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('2. transición background → active dispara flushPending (diario y peso) para el usuario actual', () => {
    mockCurrentAppState = 'background';
    attachAppStateFlushListener();

    registeredCallback?.('active');

    expect(mockDiaryFlushPending).toHaveBeenCalledTimes(1);
    expect(mockDiaryFlushPending).toHaveBeenCalledWith(USER.id);
    expect(mockWeightFlushPending).toHaveBeenCalledTimes(1);
    expect(mockWeightFlushPending).toHaveBeenCalledWith(USER.id);
  });

  it('2b. transición inactive → active también dispara (mismo tratamiento que background)', () => {
    mockCurrentAppState = 'inactive';
    attachAppStateFlushListener();

    registeredCallback?.('active');

    expect(mockDiaryFlushPending).toHaveBeenCalledTimes(1);
    expect(mockWeightFlushPending).toHaveBeenCalledTimes(1);
  });

  it('3. permanecer en active (ningún evento real de "vuelta a primer plano") no dispara nada', () => {
    mockCurrentAppState = 'active';
    attachAppStateFlushListener();

    // AppState real nunca emite 'change' de active→active, pero comprobamos
    // explícitamente que, si ocurriera, el listener no lo trataría como
    // "vuelta a primer plano" (documenta la guarda, no confía sólo en que
    // el sistema operativo no lo emita).
    registeredCallback?.('active');

    expect(mockDiaryFlushPending).not.toHaveBeenCalled();
    expect(mockWeightFlushPending).not.toHaveBeenCalled();
  });

  it('4. sin usuario autenticado → no dispara sync', () => {
    mockAuthGetState.mockReturnValue({ user: null });
    mockCurrentAppState = 'background';
    attachAppStateFlushListener();

    registeredCallback?.('active');

    expect(mockDiaryFlushPending).not.toHaveBeenCalled();
    expect(mockWeightFlushPending).not.toHaveBeenCalled();
  });

  it('5. el cleanup devuelto desuscribe el listener', () => {
    const detach = attachAppStateFlushListener();
    expect(mockRemove).not.toHaveBeenCalled();

    detach();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
