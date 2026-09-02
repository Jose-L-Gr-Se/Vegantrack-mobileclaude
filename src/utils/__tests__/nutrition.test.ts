/**
 * Tests de paridad: estos valores deben coincidir EXACTAMENTE con los que
 * calcula la PWA para el mismo perfil (Mifflin-St Jeor + multiplicadores).
 */
import {
  calculateTargets,
  calculateTDEE,
  getAge,
  MIN_SCORE_CONFIDENCE,
  meetsMinConfidence,
  microConfidence,
  resolveMicroDisplay,
  scaleServing,
  summarizeEntries,
  type MicroConfidence,
} from '@/utils/nutrition';
import type { FoodLogEntry, MicroAggregate } from '@/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

// Perfil de referencia: hombre, 80 kg, 180 cm, 30 años, moderado, mantener
const profile = {
  weight_kg: 80,
  height_cm: 180,
  birth_date: birthDateYearsAgo(30),
  sex: 'male' as const,
  activity_level: 'moderate' as const,
  goal: 'maintain' as const,
};

function birthDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 1); // ya cumplió este año
  return d.toISOString().split('T')[0];
}

describe('calculateTDEE', () => {
  it('aplica Mifflin-St Jeor con multiplicador de actividad', () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780 → TDEE = 1780 * 1.55 = 2759
    expect(calculateTDEE(profile)).toBe(2759);
  });

  it('resta 161 para mujeres', () => {
    // BMR = 10*60 + 6.25*165 - 5*30 - 161 = 1320.25 → ×1.2 = 1584.3 → 1584
    expect(
      calculateTDEE({ ...profile, weight_kg: 60, height_cm: 165, sex: 'female', activity_level: 'sedentary' })
    ).toBe(1584);
  });

  it('devuelve null si faltan datos', () => {
    expect(calculateTDEE({ ...profile, weight_kg: null })).toBeNull();
  });
});

describe('calculateTargets', () => {
  it('mantener: TDEE sin ajuste, proteína 1.8 g/kg, grasa 25% kcal', () => {
    const t = calculateTargets(profile)!;
    expect(t.calories).toBe(2759);
    expect(t.protein_g).toBe(144); // 80 * 1.8
    expect(t.fat_g).toBe(77); // 2759*0.25/9 = 76.6 → 77
    expect(t.carbs_g).toBe(373); // (2759 - 144*4 - 77*9)/4
  });

  it('cut resta 500 kcal y bulk suma 300', () => {
    expect(calculateTargets({ ...profile, goal: 'cut' })!.calories).toBe(2259);
    expect(calculateTargets({ ...profile, goal: 'bulk' })!.calories).toBe(3059);
  });
});

describe('getAge', () => {
  it('no cuenta el año si aún no ha cumplido', () => {
    expect(getAge('2000-12-31', new Date('2026-06-11'))).toBe(25);
    expect(getAge('2000-01-01', new Date('2026-06-11'))).toBe(26);
  });
});

describe('scaleServing', () => {
  it('escala por-100g a la ración con redondeo', () => {
    expect(scaleServing(8.9, 150)).toBe(13.4); // lentejas 150 g
  });
});

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
  };
}

describe('summarizeEntries', () => {
  it('suma macros y calcula cobertura de micros', () => {
    const entries = [
      makeEntry({ iron_mg: 4, iron_known: true }),
      makeEntry({ calories: 200, protein_g: 15 }),
    ];
    const s = summarizeEntries(entries);
    expect(s.calories).toBe(300);
    expect(s.protein_g).toBe(25);
    expect(s.micros.iron_mg.value).toBe(4);
    expect(s.micros.iron_mg.knownEntries).toBe(1);
    expect(s.micros.iron_mg.totalEntries).toBe(2);
    expect(s.micros.iron_mg.coverage).toBe(0.5);
  });

  it('las entries manuales sin micro conocido no penalizan la cobertura', () => {
    const entries = [
      makeEntry({ iron_mg: 4, iron_known: true }),
      makeEntry({ source: 'manual' }),
    ];
    const s = summarizeEntries(entries);
    expect(s.micros.iron_mg.totalEntries).toBe(1);
    expect(s.micros.iron_mg.coverage).toBe(1);
  });

  it('aplica overrides a micros desconocidos', () => {
    const entries = [makeEntry({ food_name: 'tofu firme', serving_size_g: 200 })];
    const overrides = [
      {
        food_name_pattern: 'tofu',
        match_type: 'contains' as const,
        vitamin_b12_mcg_per_100g: null,
        iron_mg_per_100g: 2.7,
        zinc_mg_per_100g: null,
        calcium_mg_per_100g: 350,
        vitamin_d_mcg_per_100g: null,
        omega3_g_per_100g: null,
      },
    ];
    const s = summarizeEntries(entries, overrides);
    expect(s.micros.iron_mg.value).toBe(5.4); // 2.7 × 2
    expect(s.micros.calcium_mg.value).toBe(700);
    expect(s.micros.zinc_mg.knownEntries).toBe(0);
  });
});

/**
 * Regresión del P0 de micronutrientes: `value` nunca se sustituye por 0 por
 * baja cobertura. Casos D-K del diseño aprobado.
 * Ver docs/NUTRICION-MICRONUTRIENTES.md (Fase 1).
 */
describe('summarizeEntries · known/unknown (P0 micronutrientes)', () => {
  it('1 · 1 alimento conocido + 3 desconocidos: value conserva el dato conocido', () => {
    const entries = [
      makeEntry({ vitamin_b12_mcg: 1.8, vitamin_b12_known: true }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
    ];
    const m = summarizeEntries(entries).micros.vitamin_b12_mcg;
    expect(m.value).toBe(1.8);
    expect(m.knownEntries).toBe(1);
    expect(m.totalEntries).toBe(4);
    expect(m.coverage).toBe(0.25);
    expect(m.hasEntries).toBe(true);
  });

  it('2 · añadir más alimentos desconocidos no cambia value', () => {
    const conUnDesconocido = summarizeEntries([
      makeEntry({ vitamin_b12_mcg: 1.8, vitamin_b12_known: true }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
    ]).micros.vitamin_b12_mcg.value;

    const conTresDesconocidos = summarizeEntries([
      makeEntry({ vitamin_b12_mcg: 1.8, vitamin_b12_known: true }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
    ]).micros.vitamin_b12_mcg.value;

    expect(conUnDesconocido).toBe(1.8);
    expect(conTresDesconocidos).toBe(1.8);
    expect(conTresDesconocidos).toBe(conUnDesconocido);
  });

  it('3 · ningún dato conocido: value=0, pero hasEntries=true y la confianza no es "high"', () => {
    const entries = [
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
    ];
    const m = summarizeEntries(entries).micros.vitamin_b12_mcg;
    expect(m.value).toBe(0);
    expect(m.hasEntries).toBe(true);
    expect(m.totalEntries).toBe(2);
    expect(m.knownEntries).toBe(0);
    expect(microConfidence(m)).not.toBe('high');
  });

  it('4 · día vacío: hasEntries=false y confianza "none" — nunca un día con 0 de nutriente', () => {
    const m = summarizeEntries([]).micros.vitamin_b12_mcg;
    expect(m.hasEntries).toBe(false);
    expect(m.totalEntries).toBe(0);
    expect(m.value).toBe(0);
    expect(microConfidence(m)).toBe('none');

    // El caso 3 (registrado pero sin datos) y el caso 4 (nada registrado)
    // comparten value=0 pero deben ser DISTINGUIBLES por hasEntries/confianza.
    const registradoSinDatos = summarizeEntries([
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
    ]).micros.vitamin_b12_mcg;
    expect(registradoSinDatos.hasEntries).toBe(true);
    expect(registradoSinDatos.hasEntries).not.toBe(m.hasEntries);
    expect(microConfidence(registradoSinDatos)).not.toBe(microConfidence(m));
  });

  it('5 · todos conocidos: cobertura alta (por entradas y por gramos)', () => {
    const m = summarizeEntries([
      makeEntry({ vitamin_b12_mcg: 1, vitamin_b12_known: true }),
      makeEntry({ vitamin_b12_mcg: 0.5, vitamin_b12_known: true }),
    ]).micros.vitamin_b12_mcg;
    expect(m.coverage).toBe(1);
    expect(m.coverageByGrams).toBe(1);
    expect(microConfidence(m)).toBe('high');
  });

  it('8 · un alimento con valor conocido 0 se distingue de uno desconocido', () => {
    const valorRealCero = summarizeEntries([
      makeEntry({ iron_mg: 0, iron_known: true }),
    ]).micros.iron_mg;
    expect(valorRealCero.value).toBe(0);
    expect(valorRealCero.knownEntries).toBe(1);
    expect(valorRealCero.totalEntries).toBe(1);
    expect(valorRealCero.coverage).toBe(1); // conocido, aunque el valor sea 0
    expect(valorRealCero.hasEntries).toBe(true);

    const desconocido = summarizeEntries([
      makeEntry({ iron_mg: null, iron_known: false }),
    ]).micros.iron_mg;
    expect(desconocido.value).toBe(0);
    expect(desconocido.knownEntries).toBe(0);
    expect(desconocido.coverage).toBe(0); // desconocido: cobertura 0, no 100%

    // Mismo `value` (0) en ambos casos; coverage/knownEntries los distingue.
    expect(valorRealCero.value).toBe(desconocido.value);
    expect(valorRealCero.coverage).not.toBe(desconocido.coverage);
  });

  it('9 · cobertura por entradas y por gramos se calculan de forma independiente', () => {
    // 1 entrada conocida GRANDE (500 g) + 3 desconocidas pequeñas (10 g c/u).
    // Por entradas: 1/4 = 25%. Por gramos: 500/530 ≈ 94% — muy distintas,
    // y la de gramos es la más representativa de "cuánto de lo comido se sabe".
    const m = summarizeEntries([
      makeEntry({ iron_mg: 4, iron_known: true, serving_size_g: 500 }),
      makeEntry({ iron_mg: null, iron_known: false, serving_size_g: 10 }),
      makeEntry({ iron_mg: null, iron_known: false, serving_size_g: 10 }),
      makeEntry({ iron_mg: null, iron_known: false, serving_size_g: 10 }),
    ]).micros.iron_mg;

    expect(m.coverage).toBeCloseTo(0.25, 5);
    expect(m.coverageByGrams).toBeCloseTo(500 / 530, 5);
    expect(m.coverage).not.toBeCloseTo(m.coverageByGrams, 2);
  });

  it('10 · nunca reaparece el comportamiento antiguo (coverage < 0.5 => value = 0)', () => {
    // Caso literal del bug reportado: 1 conocido + 3 desconocidos, coverage=0.25<0.5.
    const entries = [
      makeEntry({ vitamin_b12_mcg: 1.8, vitamin_b12_known: true }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
      makeEntry({ vitamin_b12_mcg: null, vitamin_b12_known: false }),
    ];
    const m = summarizeEntries(entries).micros.vitamin_b12_mcg;
    expect(m.coverage).toBeLessThan(0.5);
    expect(m.value).not.toBe(0);
    expect(m.value).toBe(1.8);

    // Y la capa de presentación tampoco debe zanjarlo a 0.
    const display = resolveMicroDisplay(m, 0, 2.4);
    expect(display.knownFood).toBe(1.8);
    expect(display.known).toBe(1.8);
  });
});

describe('resolveMicroDisplay', () => {
  function agg(over: Partial<MicroAggregate>): MicroAggregate {
    return {
      value: 0,
      knownEntries: 0,
      totalEntries: 0,
      coverage: 0,
      knownGrams: 0,
      totalGrams: 0,
      coverageByGrams: 0,
      hasEntries: false,
      ...over,
    };
  }

  it('A · sin registros: hasEntries=false, confianza "none", known=0', () => {
    const d = resolveMicroDisplay(agg({}), 0, 2.4);
    expect(d.hasEntries).toBe(false);
    expect(d.confidence).toBe('none');
    expect(d.known).toBe(0);
    expect(d.knownFood).toBe(0);
  });

  it('B · registros pero ningún dato conocido: known=0, hasEntries=true', () => {
    const d = resolveMicroDisplay(
      agg({ totalEntries: 2, knownEntries: 0, value: 0, totalGrams: 200, knownGrams: 0, coverage: 0, coverageByGrams: 0, hasEntries: true }),
      0,
      2.4
    );
    expect(d.known).toBe(0);
    expect(d.hasEntries).toBe(true);
    expect(d.confidence).not.toBe('high');
  });

  it('C · alguno conocido + otros desconocidos: known = lo conocido, no se zanja a 0', () => {
    const d = resolveMicroDisplay(
      agg({ value: 1.8, totalEntries: 4, knownEntries: 1, coverage: 0.25, totalGrams: 400, knownGrams: 100, coverageByGrams: 0.25, hasEntries: true }),
      0,
      2.4
    );
    expect(d.knownFood).toBe(1.8);
    expect(d.known).toBe(1.8);
    expect(d.confidence).toBe('low'); // coverageByGrams 0.25 < 0.4
  });

  it('D · todos conocidos: known = suma completa, confianza alta', () => {
    const d = resolveMicroDisplay(
      agg({ value: 2.4, totalEntries: 2, knownEntries: 2, coverage: 1, totalGrams: 200, knownGrams: 200, coverageByGrams: 1, hasEntries: true }),
      0,
      2.4
    );
    expect(d.known).toBe(2.4);
    expect(d.pct).toBe(1);
    expect(d.confidence).toBe('high');
  });

  it('6 / E · datos conocidos + suplemento: se suma al total sin alterar la cobertura de comida', () => {
    const base = agg({ value: 1, totalEntries: 4, knownEntries: 1, coverage: 0.25, totalGrams: 400, knownGrams: 100, coverageByGrams: 0.25, hasEntries: true });
    const d = resolveMicroDisplay(base, 0.8, 2.4);
    expect(d.knownFood).toBe(1);
    expect(d.supplement).toBe(0.8);
    expect(d.known).toBeCloseTo(1.8, 5);
    // La cobertura de comida no cambia por el suplemento.
    expect(d.coverage).toBe(0.25);
    expect(d.coverageByGrams).toBe(0.25);
  });

  it('7 / F · solo suplemento cubriendo el objetivo, aunque la comida tenga cobertura baja', () => {
    const bajaCobertura = agg({ value: 0, totalEntries: 3, knownEntries: 0, coverage: 0, totalGrams: 300, knownGrams: 0, coverageByGrams: 0, hasEntries: true });
    const d = resolveMicroDisplay(bajaCobertura, 2.4, 2.4);
    expect(d.knownFood).toBe(0);
    expect(d.supplement).toBe(2.4);
    expect(d.known).toBe(2.4);
    expect(d.pct).toBe(1); // objetivo cubierto...
    expect(d.confidence).toBe('low'); // ...pero la confianza en el dato de COMIDA sigue siendo baja
  });

  it('target<=0 no revienta: pct=0', () => {
    const d = resolveMicroDisplay(agg({ value: 5, hasEntries: true }), 0, 0);
    expect(d.pct).toBe(0);
  });
});

describe('microConfidence', () => {
  const base: MicroAggregate = {
    value: 0, knownEntries: 0, totalEntries: 0, coverage: 0,
    knownGrams: 0, totalGrams: 0, coverageByGrams: 0, hasEntries: false,
  };

  it('none cuando hasEntries=false, sea cual sea coverageByGrams', () => {
    expect(microConfidence({ ...base, hasEntries: false, coverageByGrams: 1 })).toBe('none');
  });

  it('low por debajo de 0.4', () => {
    expect(microConfidence({ ...base, hasEntries: true, coverageByGrams: 0 })).toBe('low');
    expect(microConfidence({ ...base, hasEntries: true, coverageByGrams: 0.39 })).toBe('low');
  });

  it('medium entre 0.4 y 0.75 (excl.)', () => {
    expect(microConfidence({ ...base, hasEntries: true, coverageByGrams: 0.4 })).toBe('medium');
    expect(microConfidence({ ...base, hasEntries: true, coverageByGrams: 0.74 })).toBe('medium');
  });

  it('high a partir de 0.75', () => {
    expect(microConfidence({ ...base, hasEntries: true, coverageByGrams: 0.75 })).toBe('high');
    expect(microConfidence({ ...base, hasEntries: true, coverageByGrams: 1 })).toBe('high');
  });
});

describe('MIN_SCORE_CONFIDENCE / meetsMinConfidence', () => {
  it('la constante documentada es "medium" (no un número mágico repartido por archivos)', () => {
    expect(MIN_SCORE_CONFIDENCE).toBe('medium');
  });

  it('meetsMinConfidence respeta el orden none < low < medium < high', () => {
    const cases: [MicroConfidence, MicroConfidence, boolean][] = [
      ['high', 'medium', true],
      ['medium', 'medium', true],
      ['low', 'medium', false],
      ['none', 'medium', false],
      ['high', 'high', true],
      ['low', 'low', true],
      ['none', 'none', true],
    ];
    for (const [confidence, min, expected] of cases) {
      expect(meetsMinConfidence(confidence, min)).toBe(expected);
    }
  });
});
