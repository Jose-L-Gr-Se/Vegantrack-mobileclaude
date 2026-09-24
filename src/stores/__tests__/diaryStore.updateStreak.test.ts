/**
 * Auditoría de retención — P0: `update_streak` en Postgres exige
 * `update_streak(p_user_id uuid, p_date date)`, ambos parámetros
 * obligatorios (confirmado leyendo la función real en Supabase — sin
 * sobrecarga de un solo parámetro, sin valor por defecto para `p_date`).
 * Antes `addEntry` sólo pasaba `p_user_id`, así que PostgREST nunca
 * encontraba la función y la llamada fallaba SIEMPRE — de forma silenciosa,
 * porque el error ya se descartaba a propósito. La racha no avanzaba nunca
 * para ningún usuario de la app móvil.
 *
 * Mismo patrón que `diaryStore.firstFoodLogged.test.ts` (SQLite real vía
 * adaptador de test + Supabase simulado).
 */
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { NewFoodLogEntry } from '@/utils/foodEntry';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));
// diaryStore.ts lee el perfil de authStore.getState() para el texto del
// recordatorio contextual (P1 de retención) — authStore importa
// purchasesStore -> react-native-purchases, un paquete con ESM que Jest no
// transforma sin mock.
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null }) } }));

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ trackFirstFoodLoggedOnce: jest.fn() }));

const USER_ID = 'user-1';
const DATE = '2026-09-07';

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFrom.mockImplementation(() => ({
    upsert: () => Promise.resolve({ error: null }),
  }));
  mockRpc.mockImplementation(() => Promise.resolve({ error: null }));
  return { diaryStore: require('@/stores/diaryStore') as typeof DiaryStoreModule };
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

/** `update_streak` se dispara en segundo plano (fire-and-forget) justo
 * después de confirmar el guardado remoto — da tiempo a que esa promesa
 * interna corra antes de comprobar `mockRpc`. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('diaryStore.addEntry — update_streak (P0 de retención)', () => {
  it('llama a update_streak con AMBOS parámetros: p_user_id Y p_date', async () => {
    const { diaryStore } = freshModules();
    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-A'));
    await flush();

    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: DATE });
  });

  it('p_date es la fecha de LA ENTRADA, no la fecha de hoy (corregir un día pasado actualiza la racha de ese día)', async () => {
    const { diaryStore } = freshModules();
    const pastDate = '2026-01-15';
    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-B', { date: pastDate }));
    await flush();

    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: pastDate });
  });

  it('sin guardado remoto (offline u error), NO se llama a update_streak todavía — se reintentará cuando sincronice', async () => {
    const { diaryStore } = freshModules();
    mockFrom.mockImplementation(() => ({
      upsert: () => Promise.resolve({ error: { message: 'TypeError: Network request failed' } }),
    }));

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-C'));
    await flush();

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('si update_streak falla (RPC rechazada), la comida sigue guardándose sin error — no bloquea ni deshace el guardado', async () => {
    const { diaryStore } = freshModules();
    mockRpc.mockImplementation(() => Promise.reject(new Error('PGRST202: function not found')));

    const result = await diaryStore.useDiaryStore.getState().addEntry(entry('entry-D'));
    await flush();

    // El guardado ya se confirmó por red antes de intentar la racha —
    // un fallo del RPC (fire-and-forget) nunca debe reflejarse aquí.
    // `isFirstEntry: false` porque este archivo mockea
    // `trackFirstFoodLoggedOnce` sin resolución explícita (ver comentario
    // del mock más arriba) — no es el objeto de este test.
    expect(result).toEqual({ error: null, isFirstEntry: false });
    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: DATE });
  });

  it('si update_streak devuelve {error} sin rechazar la promesa, tampoco afecta al resultado de addEntry', async () => {
    const { diaryStore } = freshModules();
    mockRpc.mockImplementation(() => Promise.resolve({ error: { message: 'PGRST202' } }));

    const result = await diaryStore.useDiaryStore.getState().addEntry(entry('entry-E'));
    await flush();

    expect(result).toEqual({ error: null, isFirstEntry: false });
  });
});
