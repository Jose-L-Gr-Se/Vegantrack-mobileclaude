/**
 * Auditoría de fricción del registro recurrente — `fetchRecentFoods` debe
 * ordenar por frecuencia de uso (`use_count`) en vez de por pura recencia:
 * un alimento muy usado no debe caer detrás de uno probado una sola vez sólo
 * porque este último es más reciente. En empate de frecuencia, gana el más
 * reciente. La consulta (últimos 200 `food_log`, deduplicados por
 * `food_name|brand`) y el máximo de 15 resultados no cambian.
 */
import { useDiaryStore } from '@/stores/diaryStore';
import type { FoodLogEntry } from '@/types';

jest.mock('@/db/database', () => ({
  mirrorList: jest.fn(),
  mirrorMarkDeleted: jest.fn(),
  mirrorMarkSynced: jest.fn(),
  mirrorPending: jest.fn(),
  mirrorRemove: jest.fn(),
  mirrorReplaceDay: jest.fn(),
  mirrorUpsert: jest.fn(),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null }) } }));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

/** Query builder falso: select→eq→order→limit, `limit()` resuelve la promesa
 * (misma forma que usa `fetchRecentFoods`). */
function mockFoodLog(data: FoodLogEntry[]) {
  mockFrom.mockReset();
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data, error: null }),
  };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'food_log') return builder;
    throw new Error(`tabla inesperada en el mock: ${table}`);
  });
}

function makeEntry(over: Partial<FoodLogEntry> & { food_name: string; created_at: string }): FoodLogEntry {
  return {
    id: over.id ?? `${over.food_name}-${over.created_at}`,
    user_id: 'u1',
    date: '2026-09-20',
    meal_type: 'lunch',
    brand: null,
    barcode: null,
    serving_size_g: 100,
    calories: 100,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sugar_g: 1,
    saturated_fat_g: 1,
    sodium_mg: 100,
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
    source: 'manual',
    source_ref: null,
    is_vegan: true,
    image_url: null,
    ...over,
  } as FoodLogEntry;
}

describe('fetchRecentFoods — orden por frecuencia (auditoría de fricción del registro recurrente)', () => {
  it('un alimento con más use_count aparece antes que uno con menos, aunque este último sea más reciente', async () => {
    // B (1 vez, T9, el más reciente de todos) vs A (3 veces, la más reciente T4).
    // `data` llega en orden descendente por created_at, como en la consulta real.
    mockFoodLog([
      makeEntry({ food_name: 'B', created_at: '2026-09-20T09:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T04:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T03:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T02:00:00Z' }),
    ]);

    await useDiaryStore.getState().fetchRecentFoods('u1');
    const names = useDiaryStore.getState().recentFoods.map((r) => r.food_name);

    expect(names.indexOf('A')).toBeLessThan(names.indexOf('B'));
    expect(useDiaryStore.getState().recentFoods.find((r) => r.food_name === 'A')?.use_count).toBe(3);
    expect(useDiaryStore.getState().recentFoods.find((r) => r.food_name === 'B')?.use_count).toBe(1);
  });

  it('empate de frecuencia → gana el uso más reciente', async () => {
    // C (2 veces, la más reciente T7) vs D (2 veces, la más reciente T8) → D antes que C.
    mockFoodLog([
      makeEntry({ food_name: 'D', created_at: '2026-09-20T08:00:00Z' }),
      makeEntry({ food_name: 'C', created_at: '2026-09-20T07:00:00Z' }),
      makeEntry({ food_name: 'D', created_at: '2026-09-20T06:00:00Z' }),
      makeEntry({ food_name: 'C', created_at: '2026-09-20T05:00:00Z' }),
    ]);

    await useDiaryStore.getState().fetchRecentFoods('u1');
    const names = useDiaryStore.getState().recentFoods.map((r) => r.food_name);

    expect(names.indexOf('D')).toBeLessThan(names.indexOf('C'));
  });

  it('orden combinado: frecuencia primero, recencia sólo para desempatar (A, D, C, B)', async () => {
    mockFoodLog([
      makeEntry({ food_name: 'B', created_at: '2026-09-20T09:00:00Z' }), // count 1
      makeEntry({ food_name: 'D', created_at: '2026-09-20T08:00:00Z' }), // count 2, más reciente
      makeEntry({ food_name: 'C', created_at: '2026-09-20T07:00:00Z' }), // count 2
      makeEntry({ food_name: 'D', created_at: '2026-09-20T06:00:00Z' }),
      makeEntry({ food_name: 'C', created_at: '2026-09-20T05:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T04:00:00Z' }), // count 3
      makeEntry({ food_name: 'A', created_at: '2026-09-20T03:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T02:00:00Z' }),
    ]);

    await useDiaryStore.getState().fetchRecentFoods('u1');
    const names = useDiaryStore.getState().recentFoods.map((r) => r.food_name);

    expect(names).toEqual(['A', 'D', 'C', 'B']);
  });

  it('mantiene el máximo de 15 resultados', async () => {
    // 20 alimentos distintos, cada uno visto una sola vez (mismo use_count):
    // en el empate total gana la recencia, así que sólo deben quedar los 15
    // más recientes.
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        food_name: `Alimento ${i}`,
        // i=0 es el más reciente (T19), i=19 el más antiguo (T0).
        created_at: `2026-09-20T${String(19 - i).padStart(2, '0')}:00:00Z`,
      })
    );
    mockFoodLog(rows);

    await useDiaryStore.getState().fetchRecentFoods('u1');
    const recentFoods = useDiaryStore.getState().recentFoods;

    expect(recentFoods).toHaveLength(15);
    expect(recentFoods.map((r) => r.food_name)).toEqual(
      Array.from({ length: 15 }, (_, i) => `Alimento ${i}`)
    );
  });

  it('no cambia el significado de use_count: sigue siendo el número de apariciones en los últimos 200 registros', async () => {
    mockFoodLog([
      makeEntry({ food_name: 'A', created_at: '2026-09-20T04:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T03:00:00Z' }),
      makeEntry({ food_name: 'A', created_at: '2026-09-20T02:00:00Z' }),
    ]);

    await useDiaryStore.getState().fetchRecentFoods('u1');
    expect(useDiaryStore.getState().recentFoods[0].use_count).toBe(3);
  });
});
