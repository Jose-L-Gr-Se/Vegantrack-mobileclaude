/**
 * P1 de sincronización — Fase 1 (ver auditoría de la rama fdcd26f):
 * observabilidad de errores reales + seguridad ante invocaciones
 * concurrentes de `flushPending`, para `food_log`.
 *
 * SQLite real (better-sqlite3, mismo adaptador que database.test.ts) para
 * ejercitar la interacción real entre `flushPending` y las primitivas
 * `mirror*` — incluida la regresión del guard de tombstones (P0 ya
 * cerrado). Supabase se simula con un builder controlable por id de fila,
 * para decidir por cada una si el intento remoto tiene éxito, falla por
 * red (sin código — ver `syncError.ts`), o falla con un error real del
 * servidor.
 *
 * Aislamiento entre tests: `jest.resetModules()` fuerza a que `database.ts`
 * y `diaryStore.ts` se re-evalúen desde cero en cada test — así la variable
 * de caché `db` de `database.ts` y el guard `flushInFlight` de
 * `diaryStore.ts` (ambas module-level, no exportadas) arrancan limpias sin
 * necesitar ningún hook de reset en el código de producción.
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

const mockReportError = jest.fn();
jest.mock('@/lib/errorReporting', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: jest.fn(),
}));

const USER_ID = 'user-1';
const DATE = '2026-09-05';

type SupaResult = { error: { code: string; message: string } | null };

/** Builder de `food_log` controlable: éxito/fallo de insert y delete por id de fila. */
function mockFoodLogTable() {
  const insertResults = new Map<string, SupaResult>();
  const deleteResults = new Map<string, SupaResult>();
  const insertCalls: string[] = [];
  const deleteCalls: string[] = [];

  mockFrom.mockImplementation(() => ({
    insert: (payload: { id: string }) => {
      insertCalls.push(payload.id);
      return Promise.resolve(insertResults.get(payload.id) ?? { error: null });
    },
    delete: () => ({
      eq: (_col: string, id: string) => {
        deleteCalls.push(id);
        return Promise.resolve(deleteResults.get(id) ?? { error: null });
      },
    }),
  }));

  return { insertResults, deleteResults, insertCalls, deleteCalls };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockReportError.mockReset();
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, diaryStore };
}

function foodPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    calories: 300,
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

describe('diaryStore.flushPending — food_log (P1 sync, Fase 1)', () => {
  it('1. una operación pendiente que sincroniza correctamente → deja de estar pendiente', async () => {
    const { db, diaryStore } = freshModules();
    const { insertCalls } = mockFoodLogTable();
    const id = 'entry-1';
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    expect(insertCalls).toEqual([id]);
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('2. fallo de red (sin código) → permanece synced=0 y NO se reporta', async () => {
    const { db, diaryStore } = freshModules();
    const { insertResults } = mockFoodLogTable();
    const id = 'entry-2';
    insertResults.set(id, { error: { code: '', message: 'FetchError: Network request failed' } });
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id })]);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('3. fallo inesperado (código real del servidor) → permanece synced=0 Y llama a reportError', async () => {
    const { db, diaryStore } = freshModules();
    const { insertResults } = mockFoodLogTable();
    const id = 'entry-3';
    insertResults.set(id, { error: { code: '42501', message: 'permission denied' } });
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id })]);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = mockReportError.mock.calls[0];
    expect(reportedError).toMatchObject({ code: '42501' });
    expect(context).toMatchObject({ tag: 'sync_flush_food_log', extra: { op: 'insert', code: '42501' } });
  });

  it('4. varias operaciones pendientes → cada una se procesa de forma independiente', async () => {
    const { db, diaryStore } = freshModules();
    const { insertResults, insertCalls } = mockFoodLogTable();
    insertResults.set('ok-1', { error: null });
    insertResults.set('fail-net', { error: { code: '', message: 'timeout' } });
    insertResults.set('fail-real', { error: { code: '23503', message: 'fk violation' } });

    for (const id of ['ok-1', 'fail-net', 'fail-real']) {
      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);
    }

    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    expect(insertCalls.slice().sort()).toEqual(['fail-net', 'fail-real', 'ok-1']);
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending.map((r) => r.id).sort()).toEqual(['fail-net', 'fail-real']);
    // Sólo el error real (no el de red) genera observabilidad.
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0][1]).toMatchObject({ extra: { code: '23503' } });
  });

  it('5. dos llamadas concurrentes a flushPending → sólo una ejecución efectiva', async () => {
    const { db, diaryStore } = freshModules();
    const { insertCalls } = mockFoodLogTable();
    const id = 'entry-5';
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);

    // Sin await entre medias: la segunda llamada ve flushInFlight=true (ya
    // puesto de forma síncrona por la primera antes de su primer await) y
    // no hace nada.
    const p1 = diaryStore.useDiaryStore.getState().flushPending(USER_ID);
    const p2 = diaryStore.useDiaryStore.getState().flushPending(USER_ID);
    await Promise.all([p1, p2]);

    expect(insertCalls).toEqual([id]); // no dos intentos por la misma fila
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
  });

  it('6. regresión de tombstones: un borrado pendiente que falla en flushPending no se pierde ni se resucita', async () => {
    const { db, diaryStore } = freshModules();
    const { deleteResults, deleteCalls } = mockFoodLogTable();
    const id = 'entry-6';

    // Ya sincronizada, luego borrada offline (tombstone) y el DELETE remoto falla.
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);
    await db.mirrorMarkDeleted('food_log', id);
    deleteResults.set(id, { error: { code: '', message: 'Network request failed' } });

    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    expect(deleteCalls).toEqual([id]);
    // Sigue como tombstone pendiente — ni desaparece ni se resucita.
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
    expect((await db.mirrorList('food_log', USER_ID, DATE)).some((r) => r.id === id)).toBe(false);
    expect(mockReportError).not.toHaveBeenCalled(); // fallo de red, no se reporta

    // El guard de tombstones del P0 anterior sigue protegiéndola: un mirror
    // remoto que todavía trae la fila (el DELETE real nunca llegó a
    // Supabase) tampoco la resucita.
    await db.mirrorReplaceDay('food_log', USER_ID, DATE, [{ id, meal_type: 'lunch', payload: foodPayload(id) }]);
    expect((await db.mirrorList('food_log', USER_ID, DATE)).some((r) => r.id === id)).toBe(false);
  });
});
