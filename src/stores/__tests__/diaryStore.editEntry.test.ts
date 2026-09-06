/**
 * Auditoría del Diario — cierre de los Bugs A y C:
 *   A) edición atómica: ProductDetailSheet.commit() ya no hace
 *      deleteEntry(oldId) → addEntry(newId); reutiliza editEntry.id y deja
 *      que addEntry() haga un único upsert remoto por esa PK.
 *   C) addEntry/deleteEntry devuelven el error real cuando el fallo remoto
 *      no es transitorio, en vez de mentir con {error: null} siempre.
 *
 * SQLite real (better-sqlite3, mismo adaptador que el resto de tests de
 * sync) + Supabase simulado, mismo patrón que diaryStore.flushPending.test.ts.
 * Ejercita las funciones REALES de diaryStore.ts.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { NewFoodLogEntry } from '@/utils/foodEntry';

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

type SupaResult = { error: { code: string; message: string } | null };

/** Builder de `food_log` controlable: éxito/fallo de upsert y delete por id de fila. */
function mockFoodLogTable() {
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
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, diaryStore };
}

function entry(id: string, over: Partial<NewFoodLogEntry> = {}): NewFoodLogEntry {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    barcode: null,
    brand: null,
    serving_size_g: 100,
    calories: 300,
    protein_g: 20,
    carbs_g: 30,
    fat_g: 5,
    fiber_g: 8,
    sugar_g: 2,
    saturated_fat_g: 1,
    sodium_mg: 10,
    vitamin_b12_mcg: null,
    iron_mg: null,
    zinc_mg: null,
    calcium_mg: null,
    omega3_g: null,
    vitamin_d_mcg: null,
    vitamin_b12_known: false,
    iron_known: false,
    zinc_known: false,
    calcium_known: false,
    omega3_known: false,
    vitamin_d_known: false,
    source: 'openfoodfacts',
    source_ref: null,
    is_vegan: true,
    image_url: null,
    ...over,
  } as NewFoodLogEntry;
}

describe('diaryStore.addEntry/deleteEntry — edición atómica y errores reales (auditoría del Diario)', () => {
  it('1. editar reutilizando el mismo id: no crea una fila nueva, sobrescribe la existente', async () => {
    const { db, diaryStore } = freshModules();
    mockFoodLogTable();
    const id = 'entry-A';

    const { error: e1 } = await diaryStore.useDiaryStore.getState().addEntry(entry(id, { food_name: 'Lentejas' }));
    expect(e1).toBeNull();

    // "Edición": addEntry de nuevo con el MISMO id y contenido distinto —
    // exactamente lo que hace ahora ProductDetailSheet.commit() en isEdit,
    // sin ningún deleteEntry por medio.
    const { error: e2 } = await diaryStore
      .useDiaryStore.getState()
      .addEntry(entry(id, { food_name: 'Lentejas con arroz', calories: 450 }));
    expect(e2).toBeNull();

    const rows = await db.mirrorList<{ food_name: string; calories: number }>('food_log', USER_ID, DATE);
    expect(rows).toHaveLength(1); // una sola fila, no dos
    expect(rows[0].payload.food_name).toBe('Lentejas con arroz');
    expect(rows[0].payload.calories).toBe(450);
    expect(rows[0].synced).toBe(true);
  });

  it('3. fallo remoto NO transitorio al editar → addEntry devuelve el error real, y la entry local queda pendiente con el contenido NUEVO (no se pierde ni revierte)', async () => {
    const { db, diaryStore } = freshModules();
    const { upsertResults } = mockFoodLogTable();
    const id = 'entry-B';

    await diaryStore.useDiaryStore.getState().addEntry(entry(id, { food_name: 'Original' }));
    upsertResults.set(id, { error: { code: '42501', message: 'permission denied' } });

    const { error } = await diaryStore.useDiaryStore.getState().addEntry(entry(id, { food_name: 'Editado' }));

    expect(error).toBe('permission denied'); // error real, no null — el llamador debe saberlo
    const pending = await db.mirrorPending<{ food_name: string }>('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id })]);
    expect(pending[0].payload.food_name).toBe('Editado'); // el contenido nuevo, no se revierte al original
  });

  it('4. fallo remoto NO transitorio del delete → deleteEntry devuelve el error real y la tombstone queda pendiente', async () => {
    const { db, diaryStore } = freshModules();
    const { deleteResults } = mockFoodLogTable();
    const id = 'entry-C';

    await diaryStore.useDiaryStore.getState().addEntry(entry(id));
    deleteResults.set(id, { error: { code: '42501', message: 'permission denied' } });

    const { error } = await diaryStore.useDiaryStore.getState().deleteEntry(id);

    expect(error).toBe('permission denied');
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
  });

  it('7. altas nuevas (id nunca visto) siguen funcionando exactamente igual', async () => {
    const { db, diaryStore } = freshModules();
    const { upsertCalls } = mockFoodLogTable();
    const id = 'entry-D';

    const { error } = await diaryStore.useDiaryStore.getState().addEntry(entry(id));

    expect(error).toBeNull();
    expect(upsertCalls).toEqual([id]);
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
    expect(await db.mirrorList('food_log', USER_ID, DATE)).toHaveLength(1);
  });

  it('8. offline (fallo de red, sin código) deja la operación pendiente sin mostrar error, tanto en alta/edición como en borrado', async () => {
    const { db, diaryStore } = freshModules();
    const { upsertResults, deleteResults } = mockFoodLogTable();
    const id = 'entry-E';

    upsertResults.set(id, { error: { code: '', message: 'Network request failed' } });
    const { error: addErr } = await diaryStore.useDiaryStore.getState().addEntry(entry(id));
    expect(addErr).toBeNull(); // sin red no es error para el usuario
    expect(await db.mirrorPending('food_log', USER_ID)).toEqual([expect.objectContaining({ id })]);

    deleteResults.set(id, { error: { code: '', message: 'Network request failed' } });
    const { error: delErr } = await diaryStore.useDiaryStore.getState().deleteEntry(id);
    expect(delErr).toBeNull();
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
  });
});
