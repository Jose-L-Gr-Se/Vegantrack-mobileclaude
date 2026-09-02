/**
 * Fase 1 del P0 de unidades de suplementos — suite exhaustiva de
 * `normalizeSupplementDose()`. Ver docs/NUTRICION-MICRONUTRIENTES.md y la
 * auditoría de diseño previa a este commit.
 */
import {
  normalizeSupplementDose,
  SUPPLEMENT_CANONICAL_UNIT,
  SUPPLEMENT_PLAUSIBILITY_CEILING,
  type SupplementDoseResult,
  type SupplementDoseRejectionReason,
} from '@/utils/supplementUnits';

const MU_GREEK = 'μ'; // μ — letra griega mu
const MICRO_SIGN = 'µ'; // µ — signo micro

function expectSuccess(r: SupplementDoseResult, canonicalAmount: number, canonicalUnit: 'mcg' | 'mg' | 'g' | null) {
  expect(r.status).toBe('success');
  if (r.status !== 'success') return;
  expect(r.canonicalAmount).toBeCloseTo(canonicalAmount, 10);
  expect(r.canonicalUnit).toBe(canonicalUnit);
  expect(r.plausible).toBe(true);
}

function expectNeedsReview(r: SupplementDoseResult, canonicalAmount: number, canonicalUnit: 'mcg' | 'mg' | 'g') {
  expect(r.status).toBe('needs_review');
  if (r.status !== 'needs_review') return;
  expect(r.canonicalAmount).toBeCloseTo(canonicalAmount, 10);
  expect(r.canonicalUnit).toBe(canonicalUnit);
  expect(r.plausible).toBe(false);
  expect(typeof r.reviewReason).toBe('string');
  expect(r.reviewReason.length).toBeGreaterThan(0);
}

function expectUnsupported(r: SupplementDoseResult, reason: SupplementDoseRejectionReason) {
  expect(r.status).toBe('unsupported');
  if (r.status !== 'unsupported') return;
  expect(r.reason).toBe(reason);
  expect(typeof r.message).toBe('string');
  expect(r.message.length).toBeGreaterThan(0);
}

describe('normalizeSupplementDose · conversiones exactas (positivas)', () => {
  it('B12 1000 mcg → 1000 mcg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 1000, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' }), 1000, 'mcg');
  });

  it('B12 1 mg → 1000 mcg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 1, unit: 'mg', nutrientKey: 'vitamin_b12_mcg' }), 1000, 'mcg');
  });

  it('B12 0.5 mg → 500 mcg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 0.5, unit: 'mg', nutrientKey: 'vitamin_b12_mcg' }), 500, 'mcg');
  });

  it('vitamina D 1000 IU → 25 mcg (NIH ODS: 1 mcg = 40 IU)', () => {
    expectSuccess(normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey: 'vitamin_d_mcg' }), 25, 'mcg');
  });

  it('vitamina D 1000 UI (alias español) → 25 mcg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 1000, unit: 'UI', nutrientKey: 'vitamin_d_mcg' }), 25, 'mcg');
  });

  it('vitamina D 25 mcg → 25 mcg (ya canónico)', () => {
    expectSuccess(normalizeSupplementDose({ amount: 25, unit: 'mcg', nutrientKey: 'vitamin_d_mcg' }), 25, 'mcg');
  });

  it('omega-3 500 mg → 0.5 g', () => {
    expectSuccess(normalizeSupplementDose({ amount: 500, unit: 'mg', nutrientKey: 'omega3_g' }), 0.5, 'g');
  });

  it('calcio 1 g → 1000 mg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 1, unit: 'g', nutrientKey: 'calcium_mg' }), 1000, 'mg');
  });

  it('zinc 500 mcg → 0.5 mg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 500, unit: 'mcg', nutrientKey: 'zinc_mg' }), 0.5, 'mg');
  });

  it('hierro 0.05 g → 50 mg', () => {
    // 1 g (1000 mg) de hierro elemental supera el techo de plausibilidad de
    // §SUPPLEMENT_PLAUSIBILITY_CEILING (100 mg) — ver el caso needs_review
    // dedicado más abajo. Aquí se prueba sólo la conversión g→mg dentro de
    // un rango plausible.
    expectSuccess(normalizeSupplementDose({ amount: 0.05, unit: 'g', nutrientKey: 'iron_mg' }), 50, 'mg');
  });

  it('hierro 1 g (1000 mg) supera la plausibilidad → needs_review, no success', () => {
    expectNeedsReview(normalizeSupplementDose({ amount: 1, unit: 'g', nutrientKey: 'iron_mg' }), 1000, 'mg');
  });

  it('yodo 150 mcg → 150 mcg (canónico, aunque hoy ningún consumidor lo lea)', () => {
    expectSuccess(normalizeSupplementDose({ amount: 150, unit: 'mcg', nutrientKey: 'iodine_mcg' }), 150, 'mcg');
  });
});

describe('normalizeSupplementDose · alias de microgramo (μg / µg)', () => {
  it(`B12 1000 ${MU_GREEK}g (letra griega mu) → 1000 mcg`, () => {
    expectSuccess(normalizeSupplementDose({ amount: 1000, unit: `${MU_GREEK}g`, nutrientKey: 'vitamin_b12_mcg' }), 1000, 'mcg');
  });

  it(`B12 1000 ${MICRO_SIGN}g (signo micro) → 1000 mcg`, () => {
    expectSuccess(normalizeSupplementDose({ amount: 1000, unit: `${MICRO_SIGN}g`, nutrientKey: 'vitamin_b12_mcg' }), 1000, 'mcg');
  });

  it(`vitamina D 100 ${MU_GREEK}g → 100 mcg (fila real de producción)`, () => {
    expectSuccess(normalizeSupplementDose({ amount: 100, unit: `${MU_GREEK}g`, nutrientKey: 'vitamin_d_mcg' }), 100, 'mcg');
  });

  it('los dos caracteres "micro" son distintos puntos Unicode pero ambos son alias válidos', () => {
    expect(MU_GREEK).not.toBe(MICRO_SIGN);
    expect(MU_GREEK.codePointAt(0)).toBe(0x03bc);
    expect(MICRO_SIGN.codePointAt(0)).toBe(0x00b5);
  });

  it('el alias es insensible a mayúsculas y a espacios', () => {
    expectSuccess(normalizeSupplementDose({ amount: 25, unit: ' MCG ', nutrientKey: 'vitamin_b12_mcg' }), 25, 'mcg');
    expectSuccess(normalizeSupplementDose({ amount: 25, unit: 'Mg', nutrientKey: 'iron_mg' }), 25, 'mg');
  });
});

describe('normalizeSupplementDose · rechazos: unidad IU incompatible', () => {
  it.each([
    ['zinc_mg', 'zinc'],
    ['calcium_mg', 'calcio'],
    ['omega3_g', 'omega-3'],
    ['iron_mg', 'hierro'],
    ['vitamin_b12_mcg', 'B12'],
    ['iodine_mcg', 'yodo'],
  ] as const)('%s (%s) + IU → unit_incompatible_with_nutrient', (nutrientKey, _label) => {
    const r = normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey });
    expectUnsupported(r, 'unit_incompatible_with_nutrient');
  });

  it('no añade ninguna otra conversión IU además de vitamina D', () => {
    expect([...NUTRIENTS_WITH_IU_SUPPORT_FOR_TEST()]).toEqual(['vitamin_d_mcg']);
  });
});

// Reexpone el set privado del módulo indirectamente: se prueba por
// comportamiento (arriba) para cada nutriente menos vitamina D, y aquí sólo
// se confirma la cardinalidad a través de los propios nutrientes conocidos.
function NUTRIENTS_WITH_IU_SUPPORT_FOR_TEST(): string[] {
  const supported: string[] = [];
  for (const key of Object.keys(SUPPLEMENT_CANONICAL_UNIT) as (keyof typeof SUPPLEMENT_CANONICAL_UNIT)[]) {
    const r = normalizeSupplementDose({ amount: 100, unit: 'IU', nutrientKey: key });
    if (r.status !== 'unsupported' || r.reason !== 'unit_incompatible_with_nutrient') supported.push(key);
  }
  return supported;
}

describe('normalizeSupplementDose · rechazos: cápsula/gota con nutriente', () => {
  it('B12 + cápsula → requires_amount_per_unit', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' }), 'requires_amount_per_unit');
  });

  it('B12 + gota → requires_amount_per_unit', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 5, unit: 'gota', nutrientKey: 'vitamin_b12_mcg' }), 'requires_amount_per_unit');
  });

  it('cápsula sin tilde ("capsula") también se reconoce y se rechaza igual con nutriente', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 1, unit: 'capsula', nutrientKey: 'iron_mg' }), 'requires_amount_per_unit');
  });

  it('nunca asume 1 cápsula = 1 unidad del nutriente: el mensaje lo dice explícitamente', () => {
    const r = normalizeSupplementDose({ amount: 1, unit: 'cápsula', nutrientKey: 'omega3_g' });
    if (r.status === 'unsupported') expect(r.message).toMatch(/cápsula|gota/i);
    else throw new Error('se esperaba unsupported');
  });
});

describe('normalizeSupplementDose · rechazos: unidades y nutrientes desconocidos', () => {
  it('unidad desconocida → unknown_unit', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 10, unit: 'onzas', nutrientKey: 'iron_mg' }), 'unknown_unit');
  });

  it('unidad vacía → unknown_unit', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 10, unit: '', nutrientKey: 'iron_mg' }), 'unknown_unit');
  });

  it('nutrientKey desconocido (string no perteneciente al modelo) → unknown_nutrient', () => {
    // La columna nutrient_key no tiene CHECK constraint en Supabase — un
    // valor arbitrario es un caso real, no imposible (ver auditoría).
    expectUnsupported(normalizeSupplementDose({ amount: 10, unit: 'mg', nutrientKey: 'selenium_mg' }), 'unknown_nutrient');
  });

  it('la unidad se valida ANTES que el nutriente: unidad desconocida + nutriente desconocido → unknown_unit', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 10, unit: 'onzas', nutrientKey: 'no_existe' }), 'unknown_unit');
  });
});

describe('normalizeSupplementDose · rechazos: cantidad inválida', () => {
  it('negativo → invalid_amount', () => {
    expectUnsupported(normalizeSupplementDose({ amount: -25, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' }), 'invalid_amount');
  });

  it('NaN → invalid_amount', () => {
    expectUnsupported(normalizeSupplementDose({ amount: NaN, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' }), 'invalid_amount');
  });

  it('Infinity → invalid_amount', () => {
    expectUnsupported(normalizeSupplementDose({ amount: Infinity, unit: 'mg', nutrientKey: 'iron_mg' }), 'invalid_amount');
  });

  it('-Infinity → invalid_amount', () => {
    expectUnsupported(normalizeSupplementDose({ amount: -Infinity, unit: 'mg', nutrientKey: 'iron_mg' }), 'invalid_amount');
  });

  it('cero → invalid_amount (mismo criterio que SupplementEditor.submit() ya usa hoy)', () => {
    expectUnsupported(normalizeSupplementDose({ amount: 0, unit: 'mg', nutrientKey: 'iron_mg' }), 'invalid_amount');
  });

  it('cantidad inválida se detecta antes que cualquier problema de unidad', () => {
    expectUnsupported(normalizeSupplementDose({ amount: NaN, unit: 'onzas', nutrientKey: null }), 'invalid_amount');
  });
});

describe('normalizeSupplementDose · casos especiales', () => {
  it('nutrientKey null + cápsula → success, sin convertir (recuento puro)', () => {
    expectSuccess(normalizeSupplementDose({ amount: 1, unit: 'cápsula', nutrientKey: null }), 1, null);
  });

  it('nutrientKey null + gota → success, sin convertir', () => {
    expectSuccess(normalizeSupplementDose({ amount: 10, unit: 'gota', nutrientKey: null }), 10, null);
  });

  it('nutrientKey null + unidad de masa (mg) → success, sin convertir tampoco (no hay canónica a la que convertir)', () => {
    expectSuccess(normalizeSupplementDose({ amount: 400, unit: 'mg', nutrientKey: null }), 400, null);
  });

  it('cantidades con decimales se preservan sin redondeo espurio', () => {
    expectSuccess(normalizeSupplementDose({ amount: 0.001, unit: 'g', nutrientKey: 'calcium_mg' }), 1, 'mg');
    expectSuccess(normalizeSupplementDose({ amount: 2.5, unit: 'mg', nutrientKey: 'zinc_mg' }), 2.5, 'mg');
  });

  it('cantidad que supera la plausibilidad → needs_review, no success ni unsupported', () => {
    const r = normalizeSupplementDose({ amount: 20_000, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' });
    expectNeedsReview(r, 20_000, 'mcg');
  });
});

describe('normalizeSupplementDose · semántica de plausibilidad (corrección aplicada)', () => {
  it('convertible + plausible → success utilizable (canonicalAmount listo para sumar)', () => {
    const r = normalizeSupplementDose({ amount: 25, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' });
    expect(r.status).toBe('success');
    if (r.status === 'success') expect(r.plausible).toBe(true);
  });

  it('convertible + implausible → needs_review, nunca success ni un 0 silencioso', () => {
    const r = normalizeSupplementDose({ amount: 93_402, unit: 'mg', nutrientKey: 'zinc_mg' });
    expect(r.status).not.toBe('success');
    expect(r.status).toBe('needs_review');
  });

  it('needs_review conserva la conversión ya calculada (canonicalAmount/canonicalUnit no se pierden)', () => {
    const r = normalizeSupplementDose({ amount: 150, unit: 'g', nutrientKey: 'calcium_mg' });
    expect(r.status).toBe('needs_review');
    if (r.status !== 'needs_review') return;
    expect(r.canonicalAmount).toBeCloseTo(150_000, 10);
    expect(r.canonicalUnit).toBe('mg');
  });

  it('needs_review NO se confunde con unsupported: son estados distintos con formas distintas', () => {
    const review = normalizeSupplementDose({ amount: 46_856, unit: 'mg', nutrientKey: 'omega3_g' });
    const rejected = normalizeSupplementDose({ amount: 1, unit: 'cápsula', nutrientKey: 'omega3_g' });
    expect(review.status).toBe('needs_review');
    expect(rejected.status).toBe('unsupported');
    expect(review.status).not.toBe(rejected.status);
    // needs_review lleva canonicalAmount/canonicalUnit; unsupported lleva reason/message — formas disjuntas.
    expect('canonicalAmount' in review).toBe(true);
    expect('canonicalAmount' in rejected).toBe(false);
    expect('reason' in rejected).toBe(true);
    expect('reason' in review).toBe(false);
  });

  it('justo en el techo de plausibilidad es plausible; un paso por encima ya no', () => {
    const ceiling = SUPPLEMENT_PLAUSIBILITY_CEILING.iron_mg;
    const atCeiling = normalizeSupplementDose({ amount: ceiling, unit: 'mg', nutrientKey: 'iron_mg' });
    const overCeiling = normalizeSupplementDose({ amount: ceiling + 0.001, unit: 'mg', nutrientKey: 'iron_mg' });
    expect(atCeiling.status).toBe('success');
    expect(overCeiling.status).toBe('needs_review');
  });

  it('los techos de plausibilidad viven en un único mapa con nombre, uno por nutriente conocido', () => {
    const nutrientKeys = Object.keys(SUPPLEMENT_CANONICAL_UNIT).sort();
    const ceilingKeys = Object.keys(SUPPLEMENT_PLAUSIBILITY_CEILING).sort();
    expect(ceilingKeys).toEqual(nutrientKeys);
  });
});

describe('normalizeSupplementDose · fixtures de datos reales (34 filas de producción, auditoría de solo lectura)', () => {
  it('Calcio activo, tomado 2 veces: 150 g → needs_review a 150 000 mg, NUNCA un cálculo normal', () => {
    // El hallazgo central de la auditoría: hoy el bug que ignora la unidad
    // "acierta por casualidad" sumando 150 como si ya fueran mg. Con la
    // conversión correcta y SIN el control de plausibilidad, pasaría a
    // sumar 150 000 mg silenciosamente. Este test es la regresión de eso.
    const r = normalizeSupplementDose({ amount: 150, unit: 'g', nutrientKey: 'calcium_mg' });
    expect(r.status).toBe('needs_review');
    if (r.status === 'needs_review') {
      expect(r.canonicalAmount).toBeCloseTo(150_000, 10);
      expect(r.canonicalUnit).toBe('mg');
    }
  });

  it('Omega-3 "Vitamina B12 cianocobalamina" (nutrient_key desalineado, inactivo): 46 856 mg → needs_review', () => {
    // El desajuste de nombre/nutrient_key es una clase de bug distinta (no
    // de unidades) y no se corrige aquí — este fixture sólo prueba que la
    // cantidad, tal cual está guardada, dispara plausibilidad.
    const r = normalizeSupplementDose({ amount: 46_856, unit: 'mg', nutrientKey: 'omega3_g' });
    expect(r.status).toBe('needs_review');
  });

  it('Zinc "hsfflq" (inactivo, 0 tomas, dato de prueba): 93 402 mg → needs_review', () => {
    const r = normalizeSupplementDose({ amount: 93_402, unit: 'mg', nutrientKey: 'zinc_mg' });
    expect(r.status).toBe('needs_review');
  });

  it('B12 activo, tomado 1 vez: 25 "cápsula" → unsupported (requires_amount_per_unit), no un número inventado', () => {
    const r = normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' });
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') expect(r.reason).toBe('requires_amount_per_unit');
  });

  it('B12 9 filas reales en mcg: 25 mcg → success, 25 mcg (sin cambio, ya canónico)', () => {
    expectSuccess(normalizeSupplementDose({ amount: 25, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' }), 25, 'mcg');
  });

  it(`B12 3 filas reales en ${MU_GREEK}g (preset de la PWA): 1000 → success, 1000 mcg`, () => {
    expectSuccess(normalizeSupplementDose({ amount: 1000, unit: `${MU_GREEK}g`, nutrientKey: 'vitamin_b12_mcg' }), 1000, 'mcg');
  });

  it('Vitamina D 2 filas reales en mcg: 25 → success, 25 mcg', () => {
    expectSuccess(normalizeSupplementDose({ amount: 25, unit: 'mcg', nutrientKey: 'vitamin_d_mcg' }), 25, 'mcg');
  });

  it(`Vitamina D 2 filas reales en ${MU_GREEK}g: 100 → success, 100 mcg (dentro de plausibilidad)`, () => {
    expectSuccess(normalizeSupplementDose({ amount: 100, unit: `${MU_GREEK}g`, nutrientKey: 'vitamin_d_mcg' }), 100, 'mcg');
  });

  it('Omega-3 4 filas reales en g (0.5 y 1.0): success, sin cambio', () => {
    expectSuccess(normalizeSupplementDose({ amount: 0.5, unit: 'g', nutrientKey: 'omega3_g' }), 0.5, 'g');
    expectSuccess(normalizeSupplementDose({ amount: 1, unit: 'g', nutrientKey: 'omega3_g' }), 1, 'g');
  });

  it('Creatina (nutrientKey null, 5 g): success, sin convertir — nunca entra en ningún cálculo de RDA', () => {
    expectSuccess(normalizeSupplementDose({ amount: 5, unit: 'g', nutrientKey: null }), 5, null);
  });

  it('Magnesio (nutrientKey null, 400 mg): success, sin convertir', () => {
    expectSuccess(normalizeSupplementDose({ amount: 400, unit: 'mg', nutrientKey: null }), 400, null);
  });
});
