/**
 * Fase 2 del P0 de micronutrientes — integración de `getMicroTrends`.
 *
 * Verifica, contra el store real (con Supabase simulado), que `getMicroTrends`
 * ya no aplica su propia copia del gate `coverage < 0.5 ? 0 : value` y que
 * delega en `resolveMicroDisplay` exactamente como el Dashboard y VeganScore
 * (docs/NUTRICION-MICRONUTRIENTES.md): la misma información debe producir la
 * misma decisión semántica en los tres consumidores.
 */
import { useDiaryStore } from '@/stores/diaryStore';
import { resolveMicroDisplay } from '@/utils/nutrition';
import { attributeMicroIntake } from '@/utils/microAttribution';
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
// diaryStore.ts lee el perfil de authStore.getState() para el texto del
// recordatorio contextual (P1 de retención) — authStore importa
// purchasesStore → react-native-purchases, un paquete con ESM que Jest no
// transforma sin mock.
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null, fetchProfile: jest.fn() }) } }));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
// diaryStore.ts importa @/lib/errorReporting desde el P1 de sync (Fase 1) →
// @sentry/react-native, que Jest no puede parsear sin mock (mismo motivo que
// en ErrorBoundary.test.tsx). getMicroTrends no pasa por esa ruta.
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

describe('getMicroTrends (Fase 2)', () => {
  const end = todayISO();
  const dayEmpty = addDays(end, -1); // sin ningún registro
  const dayPartial = end; // hierro con cobertura baja por gramos (0.1)

  beforeEach(() => {
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'food_log') {
        // dayPartial: 1 entrada de 100g con hierro conocido (20mg) + 3
        // entradas de 300g sin dato de hierro → knownGrams=100,
        // totalGrams=1000 → coverageByGrams=0.1 (confidence 'low'). Por
        // entradas, coverage=1/4=0.25: con el gate antiguo (< 0.5) el
        // value=20 se habría descartado a 0.
        const rows: FoodLogEntry[] = [
          makeEntry({ id: 'a', date: dayPartial, serving_size_g: 100, iron_mg: 20, iron_known: true }),
          makeEntry({ id: 'b', date: dayPartial, serving_size_g: 300 }),
          makeEntry({ id: 'c', date: dayPartial, serving_size_g: 300 }),
          makeEntry({ id: 'd', date: dayPartial, serving_size_g: 300 }),
        ];
        return makeBuilder({ data: rows });
      }
      if (table === 'supplements') return makeBuilder({ data: [] });
      if (table === 'supplement_logs') return makeBuilder({ data: [] });
      throw new Error(`tabla inesperada en el mock: ${table}`);
    });
  });

  it('un día sin ningún registro tiene hasEntries=false, distinguible de un 0 confirmado', async () => {
    const points = await useDiaryStore.getState().getMicroTrends('u1', 2, 'male');
    const empty = points.find((p) => p.date === dayEmpty)!;
    expect(empty.micros.iron_mg.hasEntries).toBe(false);
    expect(empty.micros.iron_mg.confidence).toBe('none');
    expect(empty.micros.iron_mg.value).toBe(0);
  });

  it('cobertura baja por gramos (0.1) NO descarta el value conocido a 0 (ex-bug del gate por entradas < 0.5)', async () => {
    const points = await useDiaryStore.getState().getMicroTrends('u1', 2, 'male');
    const partial = points.find((p) => p.date === dayPartial)!;
    expect(partial.micros.iron_mg.value).toBe(20);
    expect(partial.micros.iron_mg.hasEntries).toBe(true);
    expect(partial.micros.iron_mg.confidence).toBe('low');
  });

  it('produce exactamente lo mismo que llamar a resolveMicroDisplay a mano con el agregado equivalente (misma cadena, sin lógica paralela)', async () => {
    const points = await useDiaryStore.getState().getMicroTrends('u1', 2, 'male');
    const partial = points.find((p) => p.date === dayPartial)!;

    const equivalentAggregate = {
      value: 20, knownEntries: 1, totalEntries: 4, coverage: 0.25,
      knownGrams: 100, totalGrams: 1000, coverageByGrams: 0.1, hasEntries: true,
    };
    const expected = resolveMicroDisplay(equivalentAggregate, 0, 8); // ironRdaForSex('male')=8

    expect(partial.micros.iron_mg.pct).toBeCloseTo(expected.pct, 10);
    expect(partial.micros.iron_mg.value).toBeCloseTo(expected.known, 10);
    expect(partial.micros.iron_mg.confidence).toBe(expected.confidence);
  });
});

describe('getMicroTrends (Fase 2 del P0 de unidades de suplementos) · aporte de suplementos normalizado', () => {
  // Sin comida: aísla el aporte de suplemento en micros[key].value/pct.
  const end = todayISO();
  const day = end;

  function mockSupplementsAndLogs(supplement: { id: string; nutrient_key: string; dose_amount: number; dose_unit: string }) {
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'food_log') return makeBuilder({ data: [] });
      if (table === 'supplements') return makeBuilder({ data: [supplement] });
      if (table === 'supplement_logs') {
        return makeBuilder({ data: [{ supplement_id: supplement.id, date: day }] });
      }
      throw new Error(`tabla inesperada en el mock: ${table}`);
    });
  }

  it('B12 tomado en mg se convierte a mcg antes de sumarse a la tendencia (ya no se asume la unidad canónica)', async () => {
    mockSupplementsAndLogs({ id: 'supp-1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 1, dose_unit: 'mg' });
    const points = await useDiaryStore.getState().getMicroTrends('u1', 1, 'male');
    const point = points.find((p) => p.date === day)!;
    // 1 mg = 1000 mcg, no "1" crudo.
    expect(point.micros.vitamin_b12_mcg.value).toBeCloseTo(1000, 6);
  });

  it('calcio tomado en gramos con una dosis implausible (150 g, fila real de producción) NO se suma a la tendencia', async () => {
    mockSupplementsAndLogs({ id: 'supp-1', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' });
    const points = await useDiaryStore.getState().getMicroTrends('u1', 1, 'male');
    const point = points.find((p) => p.date === day)!;
    // Antes de esta fase se habría sumado "150" crudo (parecía razonable
    // por casualidad); con la conversión correcta sería 150 000 mg — pero
    // al superar la plausibilidad, needs_review se excluye del todo, nunca
    // entra en la tendencia con un número que no se puede confiar.
    expect(point.micros.calcium_mg.value).toBe(0);
  });

  it('suplemento con unidad no soportada (cápsula + nutriente) no se suma a la tendencia', async () => {
    mockSupplementsAndLogs({ id: 'supp-1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula' });
    const points = await useDiaryStore.getState().getMicroTrends('u1', 1, 'male');
    const point = points.find((p) => p.date === day)!;
    expect(point.micros.vitamin_b12_mcg.value).toBe(0);
  });

  it('dos filas de supplement_logs para el MISMO suplemento el mismo día no duplican el aporte (dos dispositivos marcándolo casi a la vez)', async () => {
    // Mismo supplement_id, misma fecha, dos filas — el escenario que puede
    // dejar dos inserts para la misma toma (dos dispositivos, cada uno sin
    // haber visto aún el insert del otro). El Dashboard de HOY nunca lo
    // duplicaría (mapa `takenToday` por supplement_id en supplementStore);
    // esta tendencia histórica sí sumaba una fila por cada una, antes del fix.
    mockFrom.mockReset();
    const supplement = { id: 'supp-1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'food_log') return makeBuilder({ data: [] });
      if (table === 'supplements') return makeBuilder({ data: [supplement] });
      if (table === 'supplement_logs') {
        return makeBuilder({
          data: [
            { supplement_id: supplement.id, date: day },
            { supplement_id: supplement.id, date: day },
          ],
        });
      }
      throw new Error(`tabla inesperada en el mock: ${table}`);
    });

    const points = await useDiaryStore.getState().getMicroTrends('u1', 1, 'male');
    const point = points.find((p) => p.date === day)!;
    expect(point.micros.vitamin_b12_mcg.value).toBeCloseTo(25, 6); // nunca 50
  });
});

describe('getMicroTrends · atribución comida vs. suplemento (campos aditivos — no cambia ningún total)', () => {
  const end = todayISO();
  const yesterday = addDays(end, -1);

  function mockData(opts: {
    food?: FoodLogEntry[];
    supplements?: { id: string; nutrient_key: string; dose_amount: number; dose_unit: string }[];
    logs?: { supplement_id: string; date: string }[];
  }) {
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'food_log') return makeBuilder({ data: opts.food ?? [] });
      if (table === 'supplements') return makeBuilder({ data: opts.supplements ?? [] });
      if (table === 'supplement_logs') return makeBuilder({ data: opts.logs ?? [] });
      throw new Error(`tabla inesperada en el mock: ${table}`);
    });
  }

  const ironSupplement = { id: 'supp-iron', nutrient_key: 'iron_mg', dose_amount: 14, dose_unit: 'mg' };

  it('mezcla: comida y suplemento quedan SEPARADOS, y value sigue siendo exactamente su suma', async () => {
    mockData({
      food: [makeEntry({ id: 'a', date: end, serving_size_g: 100, iron_mg: 6, iron_known: true })],
      supplements: [ironSupplement],
      logs: [{ supplement_id: ironSupplement.id, date: end }],
    });
    const point = (await useDiaryStore.getState().getMicroTrends('u1', 1, 'male')).find((p) => p.date === end)!;
    const iron = point.micros.iron_mg;

    expect(iron.knownFood).toBe(6);
    expect(iron.supplement).toBeCloseTo(14, 6);
    expect(iron.coverageByGrams).toBe(1);
    expect(iron.supplementUnresolved).toBe(false);
    expect(iron.value).toBe(iron.knownFood + iron.supplement); // invariante: nada cambia de total
  });

  it('100 % alimentos: sin suplementos, supplement=0 y nada marcado como desconocido', async () => {
    mockData({ food: [makeEntry({ id: 'a', date: end, serving_size_g: 100, iron_mg: 6, iron_known: true })] });
    const iron = (await useDiaryStore.getState().getMicroTrends('u1', 1, 'male'))[0].micros.iron_mg;

    expect(iron.knownFood).toBe(6);
    expect(iron.supplement).toBe(0);
    expect(iron.supplementUnresolved).toBe(false);
    expect(attributeMicroIntake([iron]).shares).toEqual({ food: 1, supplement: 0 });
  });

  it('100 % suplemento: sin comida registrada, knownFood=0 y hasEntries=false', async () => {
    const b12 = { id: 'supp-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' };
    mockData({ supplements: [b12], logs: [{ supplement_id: b12.id, date: end }] });
    const micro = (await useDiaryStore.getState().getMicroTrends('u1', 1, 'male'))[0].micros.vitamin_b12_mcg;

    expect(micro.knownFood).toBe(0);
    expect(micro.supplement).toBeCloseTo(25, 6);
    expect(micro.hasEntries).toBe(false);
    expect(micro.value).toBeCloseTo(25, 6);
    expect(attributeMicroIntake([micro]).shares).toEqual({ food: 0, supplement: 1 });
  });

  it('comida con cobertura parcial: knownFood conserva lo conocido y la atribución NO afirma un reparto', async () => {
    // Mismo escenario que el test de "cobertura baja" de arriba: 20 mg conocidos de 1000 g (0,1).
    mockData({
      food: [
        makeEntry({ id: 'a', date: end, serving_size_g: 100, iron_mg: 20, iron_known: true }),
        makeEntry({ id: 'b', date: end, serving_size_g: 900 }),
      ],
      supplements: [ironSupplement],
      logs: [{ supplement_id: ironSupplement.id, date: end }],
    });
    const iron = (await useDiaryStore.getState().getMicroTrends('u1', 1, 'male'))[0].micros.iron_mg;

    expect(iron.knownFood).toBe(20);
    expect(iron.coverageByGrams).toBeCloseTo(0.1, 10);
    expect(attributeMicroIntake([iron]).shares).toBeNull();
  });

  it('suplemento con unidad no soportada (cápsula): total sin cambios (0) pero marcado como aporte desconocido', async () => {
    const capsule = { id: 'supp-1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula' };
    mockData({ supplements: [capsule], logs: [{ supplement_id: capsule.id, date: end }] });
    const point = (await useDiaryStore.getState().getMicroTrends('u1', 1, 'male'))[0];

    expect(point.micros.vitamin_b12_mcg.value).toBe(0);
    expect(point.micros.vitamin_b12_mcg.supplement).toBe(0);
    expect(point.micros.vitamin_b12_mcg.supplementUnresolved).toBe(true);
    // Sólo el nutriente de esa toma: los demás no quedan marcados.
    expect(point.micros.iron_mg.supplementUnresolved).toBe(false);
  });

  it('dosis needs_review (calcio 150 g): tampoco se suma, y queda marcada como desconocida', async () => {
    const implausible = { id: 'supp-1', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' };
    mockData({ supplements: [implausible], logs: [{ supplement_id: implausible.id, date: end }] });
    const calcium = (await useDiaryStore.getState().getMicroTrends('u1', 1, 'male'))[0].micros.calcium_mg;

    expect(calcium.value).toBe(0);
    expect(calcium.supplementUnresolved).toBe(true);
  });

  it('la marca de "desconocido" es POR DÍA: una toma no interpretable de ayer no contamina hoy', async () => {
    const capsule = { id: 'supp-1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula' };
    mockData({ supplements: [capsule], logs: [{ supplement_id: capsule.id, date: yesterday }] });
    const points = await useDiaryStore.getState().getMicroTrends('u1', 2, 'male');

    expect(points.find((p) => p.date === yesterday)!.micros.vitamin_b12_mcg.supplementUnresolved).toBe(true);
    expect(points.find((p) => p.date === end)!.micros.vitamin_b12_mcg.supplementUnresolved).toBe(false);
  });

  it('el total histórico es EXACTAMENTE el de siempre: value/pct/hasEntries/confidence con las cifras que ya producía', async () => {
    // Dos días con cifras fijas (hierro, RDA hombre = 8). Estos números son los
    // que producía getMicroTrends ANTES de añadir la atribución (value =
    // comida + suplemento; pct = value / 8): la atribución sólo añade campos.
    mockData({
      food: [
        makeEntry({ id: 'y', date: yesterday, serving_size_g: 100, iron_mg: 5, iron_known: true }),
        makeEntry({ id: 't', date: end, serving_size_g: 100, iron_mg: 6, iron_known: true }),
      ],
      supplements: [ironSupplement],
      logs: [{ supplement_id: ironSupplement.id, date: end }],
    });
    const points = await useDiaryStore.getState().getMicroTrends('u1', 2, 'male');
    const y = points.find((p) => p.date === yesterday)!.micros.iron_mg;
    const t = points.find((p) => p.date === end)!.micros.iron_mg;

    expect({ value: y.value, pct: y.pct, hasEntries: y.hasEntries, confidence: y.confidence }).toEqual({
      value: 5, pct: 0.625, hasEntries: true, confidence: 'high',
    });
    expect({ value: t.value, pct: t.pct, hasEntries: t.hasEntries, confidence: t.confidence }).toEqual({
      value: 20, pct: 2.5, hasEntries: true, confidence: 'high',
    });
  });
});
