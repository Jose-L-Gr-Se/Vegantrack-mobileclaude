/**
 * Auditoría de instrumentación del funnel — `addEntry` debe medir
 * `first_food_logged` (vía `trackFirstFoodLoggedOnce`) en el momento de la
 * escritura LOCAL, no tras confirmar red: coherente con offline-first, y es
 * el único punto real de entrada de comida al diario (recetas y copiar
 * entradas delegan en `addEntry`, ver `recipeStore.logRecipe`).
 *
 * Mismo patrón que `diaryStore.editEntry.test.ts` (SQLite real vía adaptador
 * de test + Supabase simulado), pero aquí `trackFirstFoodLoggedOnce` se
 * mockea entera: su propio comportamiento (idempotencia por usuario,
 * persistencia real en `kv`) ya está cubierto en `analytics.funnel.test.ts`.
 */
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

const mockTrackFirstFoodLoggedOnce = jest.fn();
jest.mock('@/lib/analytics', () => ({
  trackFirstFoodLoggedOnce: (...args: unknown[]) => mockTrackFirstFoodLoggedOnce(...args),
}));

const USER_ID = 'user-1';
const DATE = '2026-09-07';

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockTrackFirstFoodLoggedOnce.mockReset();
  mockFrom.mockImplementation(() => ({
    upsert: () => Promise.resolve({ error: null }),
  }));
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

describe('diaryStore.addEntry — first_food_logged', () => {
  it('cada addEntry llama a trackFirstFoodLoggedOnce con el user_id de la entrada', async () => {
    const { diaryStore } = freshModules();
    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-A'));

    expect(mockTrackFirstFoodLoggedOnce).toHaveBeenCalledWith(USER_ID);
  });

  it('se llama incluso si el guardado remoto falla (offline-first: cuenta la escritura local)', async () => {
    const { diaryStore } = freshModules();
    // Mismo shape que devuelve el cliente real de Supabase ante un fallo de
    // red (nunca lanza — se comprobó en la auditoría de auth/timeouts):
    // `{ data: null, error: {...} }` resuelto, no una promesa rechazada.
    mockFrom.mockImplementation(() => ({
      upsert: () => Promise.resolve({ error: { message: 'TypeError: Network request failed' } }),
    }));

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-B'));

    expect(mockTrackFirstFoodLoggedOnce).toHaveBeenCalledWith(USER_ID);
  });
});
