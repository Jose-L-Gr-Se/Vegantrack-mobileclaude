/**
 * Auditoría del Diario — cierre del Bug B para `deleteEntry`: reproduce la
 * resurrección de una fila YA BORRADA cuando `deleteEntry()` compite con un
 * `fetchEntries()` concurrente cuya instantánea remota quedó obsoleta, y
 * demuestra que `withFoodLogLock` (ya usado por `flushPending`/
 * `fetchEntries` entre sí) también coordina `deleteEntry`.
 *
 * Mecanismo del bug (sin el fix): fetchEntries emite su SELECT ANTES de que
 * el DELETE de deleteEntry confirme en el servidor → su instantánea todavía
 * incluye la fila. deleteEntry confirma y hace mirrorRemove: la fila ya no
 * existe en absoluto en SQLite (ni siquiera como tombstone). Cuando
 * mirrorReplaceDay (de ese fetchEntries) reinserta su instantánea obsoleta,
 * el guard de mirrorUpsert no tiene nada que proteger (`existing` es
 * undefined) y la fila borrada reaparece.
 *
 * Mismo enfoque que diaryStore.foodLogRace.test.ts (servidor simulado con
 * un array mutable + delete/select controlables por el test), aplicado
 * aquí a deleteEntry en vez de a flushPending.
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
const DATE = '2026-09-07';

function foodPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    calories: 300,
    created_at: '2026-09-07T00:00:00.000Z',
    updated_at: '2026-09-07T00:00:00.000Z',
    ...over,
  };
}

/**
 * Mock de `food_log` respaldado por un array mutable ("servidor"). El
 * `delete` sólo quita la fila del array cuando el test llama a
 * `resolveNextDelete` (simula la latencia real); el `select` lee el array
 * en ese momento pero tampoco se resuelve hasta `resolveNextSelect` — así
 * se demuestra bloqueo real (contadores de llamadas), no orden casual.
 */
function mockFoodLogServer(options: { deleteSucceeds?: boolean } = {}) {
  const deleteSucceeds = options.deleteSucceeds ?? true;
  const serverRows: ReturnType<typeof foodPayload>[] = [];
  const deleteCalls: string[] = [];
  let selectCallCount = 0;
  const pendingDeletes: Array<() => void> = [];
  const pendingSelects: Array<() => void> = [];

  mockFrom.mockImplementation(() => ({
    upsert: (payload: ReturnType<typeof foodPayload>) => {
      serverRows.push(payload);
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      eq: (_col: string, id: string) => {
        deleteCalls.push(id);
        if (!deleteSucceeds) {
          return Promise.resolve({ error: { code: '', message: 'Network request failed' } });
        }
        return new Promise((resolve) => {
          pendingDeletes.push(() => {
            const idx = serverRows.findIndex((r) => r.id === id);
            if (idx >= 0) serverRows.splice(idx, 1);
            resolve({ error: null });
          });
        });
      },
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
    deleteCalls,
    getSelectCallCount: () => selectCallCount,
    resolveNextDelete: () => pendingDeletes.shift()?.(),
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

describe('diaryStore — deleteEntry vs fetchEntries: la fila borrada no debe resucitar (auditoría del Diario, Bug B)', () => {
  it('5. deleteEntry adquiere el lock primero: fetchEntries espera, y su propio SELECT ya no ve la fila borrada — no resucita', async () => {
    const { db, diaryStore } = freshModules();
    const { serverRows, resolveNextDelete, resolveNextSelect, getSelectCallCount } = mockFoodLogServer();
    const id = 'entry-del-1';
    serverRows.push(foodPayload(id)); // la fila ya existe en el "servidor"
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);

    // Disparo conjunto, igual que un usuario borrando justo cuando la
    // pantalla también se refresca (foco / pull-to-refresh).
    const deletePromise = diaryStore.useDiaryStore.getState().deleteEntry(id);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks();

    // Prueba de bloqueo real: fetchEntries todavía no ha podido emitir su
    // SELECT — sigue esperando su turno del lock.
    expect(getSelectCallCount()).toBe(0);

    resolveNextDelete(); // el DELETE "llega" al servidor: la fila desaparece de serverRows
    await flushMicrotasks(); // deja que fetchEntries adquiera el lock y llame a su propio select()
    resolveNextSelect();
    await Promise.all([deletePromise, fetchPromise]);

    expect(getSelectCallCount()).toBe(1); // ahora sí, y ya sin la fila en el "servidor"
    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(false); // no resucitó
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0); // tampoco quedó como tombstone huérfana
  });

  it('6. regresión de tombstones: si el delete falla (red), la tombstone sigue protegida frente a un fetchEntries concurrente que SÍ trae la fila de vuelta', async () => {
    const { db, diaryStore } = freshModules();
    // El DELETE remoto falla — la fila sigue "viva" en el servidor.
    const { serverRows, resolveNextSelect } = mockFoodLogServer({ deleteSucceeds: false });
    const id = 'entry-del-2';
    serverRows.push(foodPayload(id));
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);

    const deletePromise = diaryStore.useDiaryStore.getState().deleteEntry(id);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks(); // deleteEntry (falla al instante) termina y suelta el lock
    resolveNextSelect();
    const [{ error: deleteError }] = await Promise.all([deletePromise, fetchPromise]);

    expect(deleteError).toBeNull(); // fallo de red, no se muestra como error

    // El guard de tombstones de mirrorUpsert (P0 ya cerrado, sin tocar)
    // sigue protegiéndola pese a que el SELECT la trajo de vuelta.
    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(false);
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
  });
});
