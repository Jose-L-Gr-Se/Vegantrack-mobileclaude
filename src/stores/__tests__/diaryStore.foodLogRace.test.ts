/**
 * P1 de sincronización — corrección de la auditoría final: reproduce la
 * carrera real entre `fetchEntries()`/`mirrorReplaceDay()` y
 * `flushPending()` sobre el MISMO día en `food_log`, y demuestra que
 * `withFoodLogLock` (`diaryStore.ts`) la cierra sin tocar `mirrorReplaceDay`
 * ni el guard de tombstones (P0 ya cerrado).
 *
 * El "servidor" se modela con un array mutable (`serverRows`): el insert de
 * flushPending sólo lo puebla cuando el test llama a `resolveNextInsert`
 * (simula la latencia real de red); el select de fetchEntries lee lo que
 * HAYA en ese momento, pero tampoco se resuelve hasta que el test lo decide
 * — así se puede demostrar, con contadores de llamadas (no con timings
 * frágiles), que una operación realmente ESPERA a la otra en vez de
 * simplemente "dar la casualidad" de ejecutarse después.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

const USER_ID = 'user-1';
const DATE = '2026-09-06';

function foodPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    calories: 300,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    ...over,
  };
}

/**
 * Mock de `food_log` respaldado por un array mutable que hace de
 * "servidor". `insert` y `select` no se resuelven solos: quedan "en vuelo"
 * hasta que el test llama a `resolveNextInsert`/`resolveNextSelect` — esto
 * permite demostrar bloqueo real (con contadores de llamadas), no sólo
 * orden por casualidad.
 */
function mockFoodLogServer(options: { deleteSucceeds?: boolean } = {}) {
  const deleteSucceeds = options.deleteSucceeds ?? true;
  const serverRows: ReturnType<typeof foodPayload>[] = [];
  const insertCalls: string[] = [];
  let selectCallCount = 0;
  const pendingInserts: Array<() => void> = [];
  const pendingSelects: Array<() => void> = [];

  mockFrom.mockImplementation(() => ({
    // La producción usa upsert() (auditoría del Diario, Bug A) — mismo
    // contrato {error} que antes, sólo cambia el nombre del método.
    upsert: (payload: ReturnType<typeof foodPayload>) => {
      insertCalls.push(payload.id);
      return new Promise((resolve) => {
        pendingInserts.push(() => {
          serverRows.push(payload);
          resolve({ error: null });
        });
      });
    },
    delete: () => ({
      eq: () =>
        deleteSucceeds
          ? Promise.resolve({ error: null })
          : Promise.resolve({ error: { code: '', message: 'Network request failed' } }),
    }),
    select: () => {
      selectCallCount++;
      return {
        eq: () => ({
          eq: () => ({
            order: () =>
              new Promise((resolve) => {
                pendingSelects.push(() => {
                  resolve({
                    data: serverRows.filter((r) => r.user_id === USER_ID && r.date === DATE),
                    error: null,
                  });
                });
              }),
          }),
        }),
      };
    },
  }));

  return {
    serverRows,
    insertCalls,
    getSelectCallCount: () => selectCallCount,
    resolveNextInsert: () => pendingInserts.shift()?.(),
    resolveNextSelect: () => pendingSelects.shift()?.(),
  };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, diaryStore };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('diaryStore — carrera fetchEntries/mirrorReplaceDay vs flushPending sobre food_log', () => {
  it('1. flushPending adquiere el lock primero: fetchEntries espera a que termine, y su propio SELECT ya ve la fila sincronizada — no desaparece del espejo', async () => {
    const { db, diaryStore } = freshModules();
    const { resolveNextInsert, resolveNextSelect, getSelectCallCount } = mockFoodLogServer();
    const id = 'entry-race-1';
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

    // Disparo conjunto, igual que useFocusEffect en DiaryScreen.
    const flushPromise = diaryStore.useDiaryStore.getState().flushPending(USER_ID);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks();

    // Prueba de bloqueo real (no de orden por casualidad): mientras el
    // insert de flushPending sigue "en vuelo", fetchEntries NI SIQUIERA ha
    // podido emitir su SELECT — sigue esperando su turno del lock.
    expect(getSelectCallCount()).toBe(0);

    resolveNextInsert(); // el insert "llega" al servidor; flushPending termina y suelta el lock
    await flushMicrotasks(); // deja que fetchEntries adquiera el lock y llame a su propio select()
    resolveNextSelect();
    await Promise.all([flushPromise, fetchPromise]);

    expect(getSelectCallCount()).toBe(1); // ahora sí, y con el servidor ya actualizado
    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(true); // no desapareció
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0); // y quedó sincronizada
  });

  it('2. fetchEntries adquiere el lock primero: flushPending espera a que termine antes de intentar su propio envío', async () => {
    const { db, diaryStore } = freshModules();
    const { resolveNextSelect, resolveNextInsert, insertCalls } = mockFoodLogServer();
    const id = 'entry-race-2';
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks(); // fetchEntries ya adquirió el lock y está "colgado" en su propio SELECT

    const flushPromise = diaryStore.useDiaryStore.getState().flushPending(USER_ID);
    await flushMicrotasks();
    expect(insertCalls).toHaveLength(0); // flushPending todavía no ha podido intentar su insert

    resolveNextSelect(); // fetchEntries termina su tramo crítico y suelta el lock
    await flushMicrotasks(); // deja que flushPending adquiera el lock y llame a su propio insert()
    resolveNextInsert();
    await Promise.all([fetchPromise, flushPromise]);

    expect(insertCalls).toEqual([id]); // ahora sí pudo continuar, y terminó con normalidad
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
  });

  it('3. regresión: la tombstone sigue protegida cuando fetchEntries y flushPending compiten por el lock', async () => {
    const { db, diaryStore } = freshModules();
    // El DELETE remoto de flushPending falla (red) — la fila sigue "viva"
    // en el servidor, así que el SELECT de fetchEntries la trae de vuelta.
    const { serverRows, resolveNextSelect } = mockFoodLogServer({ deleteSucceeds: false });
    const id = 'entry-race-tomb';
    serverRows.push(foodPayload(id));

    // Ya sincronizada, luego borrada offline (tombstone).
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);
    await db.mirrorMarkDeleted('food_log', id);

    const flushPromise = diaryStore.useDiaryStore.getState().flushPending(USER_ID);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks(); // deja que flushPending (delete, falla) termine y fetchEntries adquiera el lock
    resolveNextSelect();
    await Promise.all([flushPromise, fetchPromise]);

    // El guard de tombstones de mirrorUpsert (P0 ya cerrado, sin tocar)
    // sigue protegiéndola pese a que el SELECT la trajo de vuelta.
    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(false);
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
  });
});
