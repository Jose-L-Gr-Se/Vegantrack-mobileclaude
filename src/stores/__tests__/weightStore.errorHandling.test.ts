/**
 * Auditoría transversal de comportamiento offline/online — `addLog()` y
 * `deleteLog()` devolvían siempre `{ error: null }`, sin importar el
 * resultado real de la escritura remota. A diferencia de
 * `diaryStore.addEntry()`/`deleteEntry()` (que ya distinguen un fallo
 * TRANSITORIO de red — se reintenta en silencio vía `flushPending()` — de un
 * fallo PERMANENTE del servidor, que sí se devuelve al llamador),
 * `weightStore` trataba ambos casos igual: un rechazo permanente (RLS,
 * constraint...) dejaba el registro sólo en local, `flushPending()`
 * reintentándolo para siempre sin éxito, y la pantalla (`ProgressScreen`)
 * dando el guardado/borrado por bueno sin que nada lo desmintiera — "una
 * acción que parece guardada pero en realidad sólo existe como modificación
 * local pendiente".
 *
 * Mismo arnés que `weightStore.flushPending.test.ts`/`weightStore.deleteLog.test.ts`
 * (SQLite real + builder de Supabase controlable por id).
 */
import type * as DatabaseModule from '@/db/database';
import type * as WeightStoreModule from '@/stores/weightStore';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) }) },
}));

const USER_ID = 'user-1';

type SupaError = { code: string; message: string } | null;

function mockWeightLogsTable(opts: { upsertError?: SupaError; deleteError?: SupaError } = {}) {
  mockFrom.mockImplementation(() => ({
    upsert: () => Promise.resolve({ error: opts.upsertError ?? null }),
    delete: () => ({ eq: () => Promise.resolve({ error: opts.deleteError ?? null }) }),
  }));
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockUpdateProfile.mockClear();
  const db = require('@/db/database') as typeof DatabaseModule;
  const weightStore = require('@/stores/weightStore') as typeof WeightStoreModule;
  return { db, weightStore };
}

describe('weightStore.addLog — distingue fallo transitorio de red de fallo permanente del servidor', () => {
  it('fallo transitorio (sin red, sin código) → error: null — se queda pendiente para flushPending, sin avisar', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable({ upsertError: { code: '', message: 'Network request failed' } });

    const { error } = await weightStore.useWeightStore.getState().addLog(USER_ID, '2026-09-05', 70);

    expect(error).toBeNull();
  });

  it('fallo PERMANENTE (código real del servidor) → devuelve el error, no lo trata como guardado', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable({ upsertError: { code: '23514', message: 'check constraint violation' } });

    const { error } = await weightStore.useWeightStore.getState().addLog(USER_ID, '2026-09-05', 70);

    expect(error).toBe('check constraint violation');
  });

  it('sin ningún error: sigue devolviendo error: null (comportamiento existente intacto)', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable();

    const { error } = await weightStore.useWeightStore.getState().addLog(USER_ID, '2026-09-05', 70);

    expect(error).toBeNull();
  });
});

describe('weightStore.deleteLog — misma distinción para el borrado', () => {
  it('fallo transitorio de red → error: null', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable();
    const store = weightStore.useWeightStore;
    await store.getState().addLog(USER_ID, '2026-09-05', 70);
    const id = store.getState().logs[0].id;

    mockWeightLogsTable({ deleteError: { code: '', message: 'Network request failed' } });
    const { error } = await store.getState().deleteLog(id);

    expect(error).toBeNull();
  });

  it('fallo PERMANENTE del borrado remoto → devuelve el error, no lo trata como borrado con éxito', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable();
    const store = weightStore.useWeightStore;
    await store.getState().addLog(USER_ID, '2026-09-05', 70);
    const id = store.getState().logs[0].id;

    mockWeightLogsTable({ deleteError: { code: '42501', message: 'permission denied' } });
    const { error } = await store.getState().deleteLog(id);

    expect(error).toBe('permission denied');
  });
});
