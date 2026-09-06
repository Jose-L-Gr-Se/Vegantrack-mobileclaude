/**
 * Fase 2 del P1 de sincronización — integración con el mutex de la Fase 1.
 *
 * `attachAppStateFlushListener` no implementa ninguna protección propia
 * ante invocaciones concurrentes: dos transiciones a 'active' mientras un
 * `flushPending` sigue en curso deben quedar protegidas por `flushInFlight`
 * (`diaryStore.ts`, ya cerrado en la Fase 1). Este test usa el store REAL
 * (no mockeado) + SQLite real, para comprobar el guard de verdad a través
 * del listener, en vez de simular su resultado como hace
 * `appStateSync.test.ts`.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

let registeredCallback: ((state: string) => void) | undefined;
const mockAddEventListener = jest.fn((_event: string, cb: (state: string) => void) => {
  registeredCallback = cb;
  return { remove: jest.fn() };
});
// Sólo se sustituye `AppState`, vía Proxy (no spread) — ver el comentario
// detallado en appStateSync.test.ts sobre por qué `{ ...actual }` rompe el
// arranque de jest-expo (getters perezosos de `react-native/index.js`).
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'AppState') {
        return {
          ...target.AppState,
          currentState: 'background',
          addEventListener: (...args: [string, (state: string) => void]) => mockAddEventListener(...args),
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
});

const mockAuthGetState = jest.fn();
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuthGetState() } }));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

// weightStore no es el foco de este test (su mutex es simétrico al de
// diaryStore y ya está cubierto por weightStore.flushPending.test.ts) — se
// mockea entero para mantener el test centrado en food_log.
jest.mock('@/stores/weightStore', () => ({ useWeightStore: { getState: () => ({ flushPending: jest.fn() }) } }));

const USER_ID = 'user-1';
const DATE = '2026-09-05';

function foodPayload(id: string) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    calories: 300,
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:00.000Z',
  };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockAddEventListener.mockClear();
  registeredCallback = undefined;
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { attachAppStateFlushListener } = require('@/navigation/appStateSync');
  return { db, diaryStore, attachAppStateFlushListener };
}

/** Deja correr todos los microtasks pendientes (una tanda de setTimeout(0) los agota todos). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

it('dos eventos "active" mientras flushPending sigue en curso → sólo una pasada efectiva (mutex de la Fase 1)', async () => {
  const { db, attachAppStateFlushListener } = freshModules();
  mockAuthGetState.mockReturnValue({ user: { id: USER_ID } });

  const id = 'entry-1';
  await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

  // El insert remoto se queda "colgado" (promesa que no resuelve todavía) —
  // simula un flush que sigue en curso cuando llega el segundo evento.
  const insertCalls: string[] = [];
  let resolveInsert!: (v: { error: null }) => void;
  mockFrom.mockImplementation(() => ({
    insert: (payload: { id: string }) => {
      insertCalls.push(payload.id);
      return new Promise((resolve) => {
        resolveInsert = resolve;
      });
    },
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }));

  attachAppStateFlushListener();

  // 1ª transición: dispara flushPending, que se queda a medias en el insert.
  registeredCallback?.('active');
  // 2ª transición mientras la 1ª sigue en curso: flushInFlight ya está en
  // true (se puso de forma síncrona antes de cualquier await), así que esta
  // segunda llamada a flushPending() es un no-op inmediato.
  registeredCallback?.('background');
  registeredCallback?.('active');

  await flushMicrotasks();

  // Sólo un intento de red por la fila, pese a los dos eventos 'active'.
  expect(insertCalls).toEqual([id]);

  // Se libera el insert "colgado" — la única pasada efectiva converge con normalidad.
  resolveInsert({ error: null });
  await flushMicrotasks();

  expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
});
