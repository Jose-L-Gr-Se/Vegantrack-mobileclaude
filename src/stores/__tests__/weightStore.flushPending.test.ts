/**
 * P1 de sincronización — Fase 1 (ver auditoría de la rama fdcd26f):
 * observabilidad de errores reales + seguridad ante invocaciones
 * concurrentes de `flushPending`, para `weight_logs`.
 *
 * Mismo enfoque exacto que `diaryStore.flushPending.test.ts` (SQLite real +
 * builder de Supabase controlable por id), adaptado a que `weight_logs`
 * sincroniza altas con `.upsert(onConflict: 'user_id,date')` en vez de
 * `.insert()` — la única diferencia real de comportamiento entre las dos
 * tablas, ya presente antes de esta ronda.
 */
import type * as DatabaseModule from '@/db/database';
import type * as WeightStoreModule from '@/stores/weightStore';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

const mockReportError = jest.fn();
jest.mock('@/lib/errorReporting', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: jest.fn(),
}));

// weightStore.ts importa useAuthStore sólo para `addLog` (no lo ejercitamos
// aquí, sólo flushPending) — mock vacío, seguro.
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ updateProfile: jest.fn() }) } }));

const USER_ID = 'user-1';
const DATE = '2026-09-05';

type SupaResult = { error: { code: string; message: string } | null };

/** Builder de `weight_logs` controlable: éxito/fallo de upsert y delete por id de fila. */
function mockWeightLogsTable() {
  const upsertResults = new Map<string, SupaResult>();
  const deleteResults = new Map<string, SupaResult>();
  const upsertCalls: string[] = [];
  const deleteCalls: string[] = [];

  mockFrom.mockImplementation(() => ({
    upsert: (payload: { id: string }) => {
      upsertCalls.push(payload.id);
      return Promise.resolve(upsertResults.get(payload.id) ?? { error: null });
    },
    delete: () => ({
      eq: (_col: string, id: string) => {
        deleteCalls.push(id);
        return Promise.resolve(deleteResults.get(id) ?? { error: null });
      },
    }),
  }));

  return { upsertResults, deleteResults, upsertCalls, deleteCalls };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockReportError.mockReset();
  const db = require('@/db/database') as typeof DatabaseModule;
  const weightStore = require('@/stores/weightStore') as typeof WeightStoreModule;
  return { db, weightStore };
}

function weightPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    weight_kg: 70,
    note: null,
    created_at: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

describe('weightStore.flushPending — weight_logs (P1 sync, Fase 1)', () => {
  it('1. una operación pendiente que sincroniza correctamente → deja de estar pendiente', async () => {
    const { db, weightStore } = freshModules();
    const { upsertCalls } = mockWeightLogsTable();
    const id = 'weight-1';
    await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, false);

    await weightStore.useWeightStore.getState().flushPending(USER_ID);

    expect(upsertCalls).toEqual([id]);
    expect(await db.mirrorPending('weight_logs', USER_ID)).toHaveLength(0);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('2. fallo de red (sin código) → permanece synced=0 y NO se reporta', async () => {
    const { db, weightStore } = freshModules();
    const { upsertResults } = mockWeightLogsTable();
    const id = 'weight-2';
    upsertResults.set(id, { error: { code: '', message: 'Network request failed' } });
    await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, false);

    await weightStore.useWeightStore.getState().flushPending(USER_ID);

    const pending = await db.mirrorPending('weight_logs', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id })]);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('3. fallo inesperado (código real del servidor) → permanece synced=0 Y llama a reportError', async () => {
    const { db, weightStore } = freshModules();
    const { upsertResults } = mockWeightLogsTable();
    const id = 'weight-3';
    upsertResults.set(id, { error: { code: '23514', message: 'check constraint violation' } });
    await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, false);

    await weightStore.useWeightStore.getState().flushPending(USER_ID);

    const pending = await db.mirrorPending('weight_logs', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id })]);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = mockReportError.mock.calls[0];
    expect(reportedError).toMatchObject({ code: '23514' });
    expect(context).toMatchObject({ tag: 'sync_flush_weight_logs', extra: { op: 'upsert', code: '23514' } });
  });

  it('4. varias operaciones pendientes → cada una se procesa de forma independiente', async () => {
    const { db, weightStore } = freshModules();
    const { upsertResults, upsertCalls } = mockWeightLogsTable();
    upsertResults.set('ok-1', { error: null });
    upsertResults.set('fail-net', { error: { code: '', message: 'timeout' } });
    upsertResults.set('fail-real', { error: { code: '23514', message: 'check violation' } });

    for (const id of ['ok-1', 'fail-net', 'fail-real']) {
      await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, false);
    }

    await weightStore.useWeightStore.getState().flushPending(USER_ID);

    expect(upsertCalls.slice().sort()).toEqual(['fail-net', 'fail-real', 'ok-1']);
    const pending = await db.mirrorPending('weight_logs', USER_ID);
    expect(pending.map((r) => r.id).sort()).toEqual(['fail-net', 'fail-real']);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0][1]).toMatchObject({ extra: { code: '23514' } });
  });

  it('5. dos llamadas concurrentes a flushPending → sólo una ejecución efectiva', async () => {
    const { db, weightStore } = freshModules();
    const { upsertCalls } = mockWeightLogsTable();
    const id = 'weight-5';
    await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, false);

    const p1 = weightStore.useWeightStore.getState().flushPending(USER_ID);
    const p2 = weightStore.useWeightStore.getState().flushPending(USER_ID);
    await Promise.all([p1, p2]);

    expect(upsertCalls).toEqual([id]);
    expect(await db.mirrorPending('weight_logs', USER_ID)).toHaveLength(0);
  });

  it('6. regresión de tombstones: un borrado pendiente que falla en flushPending no se pierde ni se resucita', async () => {
    const { db, weightStore } = freshModules();
    const { deleteResults, deleteCalls } = mockWeightLogsTable();
    const id = 'weight-6';

    await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, true);
    await db.mirrorMarkDeleted('weight_logs', id);
    deleteResults.set(id, { error: { code: '', message: 'Network request failed' } });

    await weightStore.useWeightStore.getState().flushPending(USER_ID);

    expect(deleteCalls).toEqual([id]);
    const pending = await db.mirrorPending('weight_logs', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
    expect((await db.mirrorList('weight_logs', USER_ID, DATE)).some((r) => r.id === id)).toBe(false);
    expect(mockReportError).not.toHaveBeenCalled();

    // weightStore.fetchLogs() hace mirrorUpsert directo por fila remota (no
    // pasa por mirrorReplaceDay) — se reproduce ese camino exacto: el guard
    // de tombstones del P0 anterior también debe protegerla aquí.
    await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, true);
    expect((await db.mirrorList('weight_logs', USER_ID, DATE)).some((r) => r.id === id)).toBe(false);
  });
});
