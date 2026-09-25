/**
 * `getVeganNutritionScoreTrend` — auditoría de histórico de VeganScore.
 *
 * Mismo arnés que `diaryStore.getMicroTrends.test.ts` (Supabase simulado con
 * un query builder encadenable): esta función reutiliza la MISMA
 * infraestructura de agregación (`fetchHistoricalFoodAndSupplements`), así
 * que estos tests se centran en lo específico de la serie de VeganScore
 * nutricional — agregación correcta por día, ventana de 7 días, y que un día
 * sin `food_log` da `score: null`, nunca un breakdown con `total: 0`.
 */
import { useDiaryStore } from '@/stores/diaryStore';
import { addDays, todayISO } from '@/utils/dates';
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

/** Query builder falso: encadenable y "thenable" como el real de supabase-js. */
function makeBuilder(payload: { data: unknown[] }) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    then: (resolve: (v: typeof payload) => void) => resolve(payload),
  };
  return builder;
}

function makeEntry(over: Partial<FoodLogEntry>): FoodLogEntry {
  return {
    id: '1', user_id: 'u', date: '2026-06-11', meal_type: 'lunch',
    food_name: 'Test', barcode: null, brand: null, serving_size_g: 100,
    calories: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 3,
    sugar_g: 1, saturated_fat_g: 1, sodium_mg: 100,
    vitamin_b12_mcg: null, iron_mg: null, zinc_mg: null, calcium_mg: null,
    omega3_g: null, vitamin_d_mcg: null,
    vitamin_b12_known: false, iron_known: false, zinc_known: false,
    calcium_known: false, omega3_known: false, vitamin_d_known: false,
    source: 'openfoodfacts', source_ref: null, is_vegan: true,
    image_url: null, created_at: '', ...over,
  } as FoodLogEntry;
}

function mockTables(foodRows: FoodLogEntry[], suppRows: unknown[] = [], logRows: unknown[] = []) {
  mockFrom.mockReset();
  mockFrom.mockImplementation((table: string) => {
    if (table === 'food_log') return makeBuilder({ data: foodRows });
    if (table === 'supplements') return makeBuilder({ data: suppRows });
    if (table === 'supplement_logs') return makeBuilder({ data: logRows });
    throw new Error(`tabla inesperada en el mock: ${table}`);
  });
}

describe('getVeganNutritionScoreTrend', () => {
  const end = todayISO();
  const perfectDay = end;
  const emptyDay = addDays(end, -1);

  it('7 días de ventana: devuelve exactamente 7 puntos, con las fechas correctas (hoy y los 6 anteriores)', async () => {
    mockTables([]);
    const points = await useDiaryStore.getState().getVeganNutritionScoreTrend('u1', 7, 2000, 120, 'male');

    expect(points).toHaveLength(7);
    const expectedDates = Array.from({ length: 7 }, (_, i) => addDays(end, -(6 - i)));
    expect(points.map((p) => p.date)).toEqual(expectedDates);
  });

  it('día sin ningún registro en food_log → score: null, NUNCA un total de 0', async () => {
    mockTables([]);
    const points = await useDiaryStore.getState().getVeganNutritionScoreTrend('u1', 2, 2000, 120, 'male');

    const empty = points.find((p) => p.date === emptyDay)!;
    expect(empty.score).toBeNull();
  });

  it('datos históricos agregados correctamente por día: varias entradas del mismo día se suman antes de puntuar', async () => {
    // Dos entradas el mismo día: 1000+1000 kcal = 2000 (objetivo), 60+60 g
    // proteína = 120 (objetivo), fibra 18+17=35 — un "día perfecto" sólo si
    // se agregan correctamente ambas filas, no si se puntuara cada una por
    // separado (cada una sola no llegaría al objetivo).
    mockTables([
      makeEntry({
        id: 'a', date: perfectDay, calories: 1000, protein_g: 60, fiber_g: 18,
        vitamin_b12_mcg: 1.2, vitamin_b12_known: true,
        vitamin_d_mcg: 7.5, vitamin_d_known: true,
        iron_mg: 4, iron_known: true,
      }),
      makeEntry({
        id: 'b', date: perfectDay, calories: 1000, protein_g: 60, fiber_g: 17,
        vitamin_b12_mcg: 1.2, vitamin_b12_known: true,
        vitamin_d_mcg: 7.5, vitamin_d_known: true,
        iron_mg: 4, iron_known: true,
      }),
    ]);

    const points = await useDiaryStore.getState().getVeganNutritionScoreTrend('u1', 1, 2000, 120, 'male');
    const day = points.find((p) => p.date === perfectDay)!;

    expect(day.score).not.toBeNull();
    expect(day.score!.calories.score).toBe(30);
    expect(day.score!.protein.score).toBe(25);
    expect(day.score!.fiber.score).toBe(15);
    expect(day.score!.total).toBe(100);
  });

  it('comportamiento con suplementos: un suplemento sube el score de micros de un día con comida', async () => {
    const foodRow = makeEntry({ id: 'a', date: perfectDay, calories: 2000, protein_g: 120, fiber_g: 35 });
    // Sin suplemento: 0/3 micros cubiertos.
    mockTables([foodRow]);
    const withoutSupp = await useDiaryStore.getState().getVeganNutritionScoreTrend('u1', 1, 2000, 120, 'male');
    const withoutSuppScore = withoutSupp.find((p) => p.date === perfectDay)!.score!;
    expect(withoutSuppScore.micros.label).toBe('0/3 cubiertos');

    // Con un suplemento de B12 que cubre de sobra la RDA (2.4 mcg) ese día.
    mockTables(
      [foodRow],
      [{ id: 'supp-1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' }],
      [{ supplement_id: 'supp-1', date: perfectDay }]
    );
    const withSupp = await useDiaryStore.getState().getVeganNutritionScoreTrend('u1', 1, 2000, 120, 'male');
    const withSuppScore = withSupp.find((p) => p.date === perfectDay)!.score!;

    expect(withSuppScore.micros.label).toBe('1/3 cubiertos');
    expect(withSuppScore.micros.score).toBeGreaterThan(withoutSuppScore.micros.score);
    expect(withSuppScore.total).toBeGreaterThan(withoutSuppScore.total);
  });
});
