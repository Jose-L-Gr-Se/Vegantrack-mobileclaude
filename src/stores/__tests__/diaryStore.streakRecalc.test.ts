/**
 * Racha cronológica — el cliente recalcula la racha (RPC `update_streak`) no
 * sólo al AÑADIR, sino también tras un BORRADO remoto confirmado y tras
 * aplicar pendientes en `flushPending` (un día registrado sin red nunca
 * contaba para la racha; borrar la última comida de un día nunca la acortaba).
 *
 * La RPC deriva la racha de `food_log` (ver la migración
 * 20260930000000_update_streak_chronological.sql), así que aquí sólo se
 * comprueba CUÁNDO se llama y que es best-effort: ningún fallo de la RPC
 * bloquea ni deshace el guardado, el borrado ni la sincronización.
 *
 * Mismo arnés que `diaryStore.flushPending.test.ts` (SQLite real + Supabase
 * simulado) y `diaryStore.streakProfileRefresh.test.ts`.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { NewFoodLogEntry } from '@/utils/foodEntry';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFetchProfile = jest.fn();
let mockUser: { id: string } | null = null;
jest.mock('@/stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ profile: null, user: mockUser, fetchProfile: (...a: unknown[]) => mockFetchProfile(...a) }),
  },
}));

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));
const mockReportError = jest.fn();
jest.mock('@/lib/errorReporting', () => ({
  reportError: (...a: unknown[]) => mockReportError(...a),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ trackFirstFoodLoggedOnce: jest.fn() }));

const USER_ID = 'user-1';
const D1 = '2026-09-20';
const D2 = '2026-09-22';

type SupaResult = { error: { code: string; message: string } | null };
const NET: SupaResult = { error: { code: '', message: 'Network request failed' } };
const SERVER: SupaResult = { error: { code: '42501', message: 'permission denied' } };

function mockFoodLog() {
  const upsertResults = new Map<string, SupaResult>();
  const deleteResults = new Map<string, SupaResult>();
  mockFrom.mockImplementation(() => ({
    upsert: (p: { id: string }) => Promise.resolve(upsertResults.get(p.id) ?? { error: null }),
    delete: () => ({ eq: (_c: string, id: string) => Promise.resolve(deleteResults.get(id) ?? { error: null }) }),
  }));
  return { upsertResults, deleteResults };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFetchProfile.mockReset();
  mockReportError.mockReset();
  mockUser = { id: USER_ID };
  mockRpc.mockImplementation(() => Promise.resolve({ error: null }));
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, store: diaryStore.useDiaryStore };
}

function payload(id: string, date: string, over: Record<string, unknown> = {}) {
  return { id, user_id: USER_ID, date, meal_type: 'lunch', food_name: 'Lentejas', calories: 300, created_at: 'x', updated_at: 'x', ...over };
}

function newEntry(id: string, date: string): NewFoodLogEntry {
  return {
    ...payload(id, date), barcode: null, brand: null, serving_size_g: 100, protein_g: 20, carbs_g: 30, fat_g: 5, fiber_g: 8,
    sugar_g: 2, saturated_fat_g: 1, sodium_mg: 10, vitamin_b12_mcg: null, iron_mg: null, zinc_mg: null, calcium_mg: null,
    omega3_g: null, vitamin_d_mcg: null, vitamin_b12_known: false, iron_known: false, zinc_known: false, calcium_known: false,
    omega3_known: false, vitamin_d_known: false, source: 'openfoodfacts', source_ref: null, is_vegan: true, image_url: null,
  } as unknown as NewFoodLogEntry;
}

/** La RPC es fire-and-forget: da tiempo a que su promesa interna corra. */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function seedRemoteEntryInStore(db: typeof DatabaseModule, store: typeof DiaryStoreModule.useDiaryStore, id: string, date: string) {
  await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date, payload: payload(id, date) } as never, true);
  store.setState({ entries: [payload(id, date) as never] });
}

describe('deleteEntry — recalcula la racha tras un borrado remoto confirmado', () => {
  it('borrado confirmado → una llamada a update_streak con el usuario y la fecha de la entrada borrada, y refresca el perfil', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    await seedRemoteEntryInStore(db, store, 'e1', D1);

    const res = await store.getState().deleteEntry('e1');
    await settle();

    expect(res).toEqual({ error: null });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: D1 });
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('sin red: NO se llama todavía (la tombstone pendiente lo hará al sincronizar)', async () => {
    const { db, store } = freshModules();
    const { deleteResults } = mockFoodLog();
    deleteResults.set('e2', NET);
    await seedRemoteEntryInStore(db, store, 'e2', D1);

    const res = await store.getState().deleteEntry('e2');
    await settle();

    expect(res).toEqual({ error: null });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('error real del servidor: se informa al llamador y NO se recalcula (no hubo borrado remoto)', async () => {
    const { db, store } = freshModules();
    const { deleteResults } = mockFoodLog();
    deleteResults.set('e3', SERVER);
    await seedRemoteEntryInStore(db, store, 'e3', D1);

    const res = await store.getState().deleteEntry('e3');
    await settle();

    expect(res.error).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('si la RPC falla (rechazo), el borrado sigue siendo correcto — nunca se deshace ni se reporta como error', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    mockRpc.mockImplementation(() => Promise.reject(new Error('PGRST202')));
    await seedRemoteEntryInStore(db, store, 'e4', D1);

    const res = await store.getState().deleteEntry('e4');
    await settle();

    expect(res).toEqual({ error: null });
    expect(store.getState().entries).toEqual([]);
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('si la RPC lanza una excepción SÍNCRONA, tampoco rompe el borrado', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    mockRpc.mockImplementation(() => {
      throw new Error('boom síncrono');
    });
    await seedRemoteEntryInStore(db, store, 'e5', D1);

    await expect(store.getState().deleteEntry('e5')).resolves.toEqual({ error: null });
  });

  it('entrada que ya no está en memoria: usa el usuario de la sesión; sin sesión no llama', async () => {
    const { store } = freshModules();
    mockFoodLog();

    await store.getState().deleteEntry('no-esta-en-entries');
    await settle();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_user_id: USER_ID });

    mockRpc.mockClear();
    mockUser = null;
    await store.getState().deleteEntry('otra');
    await settle();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('flushPending — recalcula la racha cuando aplicó operaciones pendientes', () => {
  it('entradas registradas sin red y luego sincronizadas → UNA llamada por pasada, con la fecha más reciente', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    for (const [id, date] of [['a', D1], ['b', D2], ['c', D1]] as const) {
      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date, payload: payload(id, date) } as never, false);
    }

    await store.getState().flushPending(USER_ID);
    await settle();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: D2 });
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('un borrado pendiente que por fin se aplica también recalcula', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    await db.mirrorUpsert('food_log', { id: 'd', user_id: USER_ID, date: D1, payload: payload('d', D1) } as never, true);
    await db.mirrorMarkDeleted('food_log', 'd');

    await store.getState().flushPending(USER_ID);
    await settle();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: D1 });
  });

  it('sin pendientes → no llama', async () => {
    const { store } = freshModules();
    mockFoodLog();
    await store.getState().flushPending(USER_ID);
    await settle();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('si TODO falla (red o servidor) no se aplicó nada → no llama', async () => {
    const { db, store } = freshModules();
    const { upsertResults } = mockFoodLog();
    upsertResults.set('x', NET);
    upsertResults.set('y', SERVER);
    for (const id of ['x', 'y']) {
      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: D1, payload: payload(id, D1) } as never, false);
    }

    await store.getState().flushPending(USER_ID);
    await settle();

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('con un lote mixto (una aplicada, otra fallida) recalcula una vez', async () => {
    const { db, store } = freshModules();
    const { upsertResults } = mockFoodLog();
    upsertResults.set('bad', NET);
    for (const id of ['good', 'bad']) {
      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: D1, payload: payload(id, D1) } as never, false);
    }

    await store.getState().flushPending(USER_ID);
    await settle();

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('si la RPC falla, la sincronización sigue siendo correcta: la fila queda sincronizada y no se reporta error', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    mockRpc.mockImplementation(() => Promise.reject(new Error('PGRST202')));
    await db.mirrorUpsert('food_log', { id: 'f', user_id: USER_ID, date: D1, payload: payload('f', D1) } as never, false);

    await store.getState().flushPending(USER_ID);
    await settle();

    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('una excepción síncrona de la RPC tampoco rompe flushPending', async () => {
    const { db, store } = freshModules();
    mockFoodLog();
    mockRpc.mockImplementation(() => {
      throw new Error('boom síncrono');
    });
    await db.mirrorUpsert('food_log', { id: 'g', user_id: USER_ID, date: D1, payload: payload('g', D1) } as never, false);

    await expect(store.getState().flushPending(USER_ID)).resolves.toBeUndefined();
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
    expect(mockReportError).not.toHaveBeenCalled();
  });
});

describe('addEntry — sin regresión', () => {
  it('guardado remoto confirmado → exactamente UNA llamada a update_streak y UN refresco del perfil (no se duplica)', async () => {
    const { store } = freshModules();
    mockFoodLog();

    const res = await store.getState().addEntry(newEntry('n1', D1));
    await settle();

    expect(res.error).toBeNull();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: D1 });
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('sin red no llama (lo hará flushPending) y el posterior flush llama una sola vez', async () => {
    const { store } = freshModules();
    const { upsertResults } = mockFoodLog();
    upsertResults.set('n2', NET);

    await store.getState().addEntry(newEntry('n2', D1));
    await settle();
    expect(mockRpc).not.toHaveBeenCalled();

    upsertResults.delete('n2');
    await store.getState().flushPending(USER_ID);
    await settle();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('si la RPC falla, addEntry sigue devolviendo éxito', async () => {
    const { store } = freshModules();
    mockFoodLog();
    mockRpc.mockImplementation(() => Promise.reject(new Error('PGRST202')));

    const res = await store.getState().addEntry(newEntry('n3', D1));
    await settle();

    expect(res.error).toBeNull();
  });
});
