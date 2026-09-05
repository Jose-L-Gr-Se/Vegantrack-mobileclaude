/**
 * Plausibilidad de datos nutricionales procedentes de OpenFoodFacts — P0
 * (ver auditoría: datos absurdos de OFF pueden contaminar diario, histórico,
 * micronutrientes, VeganScore, tendencias y CSV sin ningún control hoy).
 *
 * Principio central, no negociable:
 *   - Nunca convertir "dato desconocido" en "0".
 *   - Nunca "corregir" un dato sospechoso a otro valor inventado.
 * Esta función sólo CLASIFICA los valores que ya llegaron — no los toca, no
 * muta el objeto de entrada, no depende de React, Supabase, stores ni red.
 *
 * Opera sobre los campos YA CONVERTIDOS de `FoodPer100g` (mg/mcg/g — las
 * unidades que la app realmente almacena y persiste), no sobre el JSON
 * crudo de OFF: así las reglas trabajan con la misma escala que
 * `buildEntry`/`food_log`, no con la escala de origen de OFF (g/100g para
 * casi todo, incluidos los micros antes de su ×1000 / ×1e6).
 *
 * LIMITACIÓN CONOCIDA Y DELIBERADA (no silenciada): las macros (`calories`,
 * `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `sugar_g`, `saturated_fat_g`,
 * `sodium_mg`) ya llegan aquí con "ausente" colapsado a `0` por
 * `normalizeProduct` (patrón `numberOrZero`, anterior a este P0 y fuera de
 * su alcance) — a diferencia de los 6 micronutrientes, que sí preservan
 * `null` + `*_known` hasta este punto. Por eso esta función NUNCA puede
 * devolver `'unknown'` para una macro, aunque el tipo lo permita: la
 * distinción "ausente" vs "0 real" ya se perdió antes de que este validador
 * pueda actuar. Arreglarlo de raíz exigiría cambiar `normalizeProduct` de
 * `numberOrZero` a `numberOrNull` para macros, lo que en cascada tocaría
 * `food_log` (`calories`/`protein_g`/… son `NOT NULL` hoy) — exactamente el
 * tipo de cambio de modelo de datos que se decidió NO hacer en este P0.
 */
import type { FoodPer100g } from '@/types';

export type NutrientPlausibility = 'unknown' | 'valid' | 'suspicious' | 'impossible';

export interface NutrientCheck {
  status: NutrientPlausibility;
  /** Sólo presente para 'suspicious' | 'impossible' — motivo interno/depuración, no es texto de cara al usuario. */
  reason?: string;
}

/**
 * Los campos numéricos de `FoodPer100g` que se clasifican. `omega3_g` se
 * incluye por completitud aunque OFF nunca lo alimenta hoy (siempre
 * `omega3_known=false` en `productToFoodPer100g`, por diseño) — así el
 * validador ya está listo si otra fuente empieza a rellenarlo.
 */
export type ValidatedNutrientField =
  | 'calories'
  | 'protein_g'
  | 'carbs_g'
  | 'fat_g'
  | 'fiber_g'
  | 'sugar_g'
  | 'saturated_fat_g'
  | 'sodium_mg'
  | 'vitamin_b12_mcg'
  | 'iron_mg'
  | 'zinc_mg'
  | 'calcium_mg'
  | 'vitamin_d_mcg'
  | 'omega3_g';

export interface ProductNutritionValidation {
  overall: 'clean' | 'has_suspicious' | 'has_impossible';
  fields: Record<ValidatedNutrientField, NutrientCheck>;
}

/**
 * Campos sin representación de "desconocido" en `food_log` hoy:
 * `calories`/`protein_g`/`carbs_g`/`fat_g`/`fiber_g`/`sugar_g`/
 * `saturated_fat_g`/`sodium_mg` son `NOT NULL` en el esquema — a diferencia
 * de los 6 micronutrientes (`vitamin_b12_mcg`, `iron_mg`, `zinc_mg`,
 * `calcium_mg`, `vitamin_d_mcg`, `omega3_g`), que sí admiten `null` +
 * `*_known=false` y que `buildEntry()` ya excluye campo a campo sin tocar
 * el resto de la entry. Por eso SÓLO estos campos pueden bloquear el
 * guardado completo: es la única forma de no persistir un valor imposible
 * cuando no existe manera de "guardar la entry sin ese campo".
 */
const FIELDS_WITHOUT_UNKNOWN_REPRESENTATION: readonly ValidatedNutrientField[] = [
  'calories',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sugar_g',
  'saturated_fat_g',
  'sodium_mg',
];

/**
 * ¿Puede este producto convertirse en una entry y persistirse?
 *
 * Bloquea únicamente si una MACRO (o energía/sodio) es 'impossible' — el
 * caso que hoy no tiene ninguna otra salida. Un micronutriente 'impossible'
 * por sí solo NUNCA bloquea aquí: `buildEntry()` ya lo excluye campo a
 * campo (null + *_known=false) sin necesidad de impedir el resto del
 * guardado — bloquear también por eso sería una regresión respecto al
 * comportamiento ya existente (el micronutriente "sigue sin contaminar
 * cálculos", pero el resto de la entry se sigue pudiendo guardar).
 * 'suspicious' nunca bloquea, sea cual sea el campo.
 */
export function isSafeToPersist(validation: ProductNutritionValidation): boolean {
  return FIELDS_WITHOUT_UNKNOWN_REPRESENTATION.every(
    (field) => validation.fields[field].status !== 'impossible'
  );
}

// ── Wording mínimo, honesto, para la señal de UI (fase actual: sólo esto,
// sin rediseño — ver ProductDetailSheet). Nunca dice "0 mg": ni siquiera
// menciona un número, porque el número en sí es justo lo que no nos fiamos.
export const NUTRITION_QUALITY_SUSPICIOUS_TEXT = 'Algunos datos nutricionales podrían ser imprecisos.';
export const NUTRITION_QUALITY_IMPOSSIBLE_TEXT = 'Algunos datos nutricionales parecen incorrectos.';

const VALID: NutrientCheck = { status: 'valid' };
const negative = (): NutrientCheck => ({ status: 'impossible', reason: 'negative_value' });

// ── A. Imposibles físicos + C. Energía ──────────────────────────────────────
//
// Techo de energía: la grasa pura es el alimento más calórico que existe en
// la práctica, ≈884 kcal/100g (9 kcal/g × 98% grasa típico de un aceite).
// 900 kcal/100g da margen sin abrir la puerta a un error real — nada sólido
// ni líquido comestible supera eso. Deliberadamente NO se cruza con la
// composición (alcohol y polioles alteran la relación kcal↔macros de forma
// legítima; añadir esa regla ahora sería inventar un margen no justificado).
const ENERGY_IMPOSSIBLE_ABOVE_KCAL = 900;

function checkEnergy(kcal: number): NutrientCheck {
  if (kcal < 0) return negative();
  if (kcal > ENERGY_IMPOSSIBLE_ABOVE_KCAL) return { status: 'impossible', reason: 'energy_exceeds_physical_maximum' };
  return VALID;
}

// ── B. Macros totales ───────────────────────────────────────────────────────
//
// 100 g de producto no pueden contener más de ~100 g de proteína+carbohidratos
// +grasa. Margen de +5 g, no arbitrario: son tres campos redondeados de forma
// independiente por el fabricante/contribuyente (típicamente a 1 decimal
// cada uno) — la suma de tres redondeos independientes puede desviarse unos
// pocos gramos del total real sin que ningún campo individual esté "mal".
// Deliberadamente NO se suma la fibra: en el etiquetado, si los carbohidratos
// ya la incluyen o no depende de la convención (UE vs. EEUU) y del propio
// contribuyente de OFF — sumarla arriesgaría falsos positivos en productos
// altos en fibra (legumbres, salvado) sin ninguna certeza real.
const MACRO_SUM_TOLERANCE_G = 5;

// Grasa saturada / azúcares son subconjuntos de grasa / carbohidratos —
// margen menor (+3 g) porque aquí sólo hay redondeo de UN campo frente a su
// padre, no la suma de tres.
const SUBSET_TOLERANCE_G = 3;

function checkMacroComposition(
  protein: number,
  carbs: number,
  fat: number
): { protein: NutrientCheck; carbs: NutrientCheck; fat: NutrientCheck } {
  if (protein < 0 || carbs < 0 || fat < 0) {
    return {
      protein: protein < 0 ? negative() : VALID,
      carbs: carbs < 0 ? negative() : VALID,
      fat: fat < 0 ? negative() : VALID,
    };
  }
  if (protein + carbs + fat > 100 + MACRO_SUM_TOLERANCE_G) {
    const flagged: NutrientCheck = { status: 'impossible', reason: 'macro_sum_exceeds_100g' };
    return { protein: flagged, carbs: flagged, fat: flagged };
  }
  return { protein: VALID, carbs: VALID, fat: VALID };
}

function checkSubsetOf(child: number, parent: number, reason: string): NutrientCheck {
  if (child < 0) return negative();
  if (child > parent + SUBSET_TOLERANCE_G) return { status: 'impossible', reason };
  return VALID;
}

function checkNonNegativeOnly(value: number): NutrientCheck {
  return value < 0 ? negative() : VALID;
}

// ── Sodio/sal: caso explícito del encargo (sal de mesa ~38.000 mg/100g) ─────
//
// - Techo "sospechoso": el sodio de la sal de mesa PURA (NaCl es 39,3% sodio
//   en masa) — ≈39.300 mg/100g. Redondeado a 40.000 con margen. Nada por
//   debajo de esto debe marcarse siquiera como sospechoso.
// - Techo "imposible": conservación de masa — 100 g de producto no pueden
//   contener más de 100 g (100.000 mg) de un solo nutriente. No es un
//   umbral clínico ni de composición, es aritmética pura.
const SODIUM_SUSPICIOUS_ABOVE_MG = 40_000;
const SODIUM_IMPOSSIBLE_ABOVE_MG = 100_000;

function checkSodium(mg: number): NutrientCheck {
  if (mg < 0) return negative();
  if (mg > SODIUM_IMPOSSIBLE_ABOVE_MG) return { status: 'impossible', reason: 'exceeds_mass_conservation' };
  if (mg > SODIUM_SUSPICIOUS_ABOVE_MG) return { status: 'suspicious', reason: 'exceeds_pure_salt_sodium_content' };
  return VALID;
}

// ── D. Micronutrientes: NUNCA la RDA como techo ─────────────────────────────
//
// Cada techo "sospechoso" está puesto muy por encima del producto real más
// concentrado conocido (alimentos fortificados incluidos) — el objetivo es
// detectar errores de unidad (el caso ×1000 de la auditoría), no valores
// altos por fortificación legítima. El techo "imposible" es varias veces
// mayor aún que el "sospechoso": sólo dispara ante magnitudes que ningún
// alimento real alcanza, fortificado o no.
interface MicroThreshold {
  suspiciousAboveMg: number;
  impossibleAboveMg: number;
}

const MICRO_THRESHOLDS: Record<
  'vitamin_b12_mcg' | 'iron_mg' | 'zinc_mg' | 'calcium_mg' | 'vitamin_d_mcg',
  MicroThreshold
> = {
  // Cereales muy fortificados rondan 15-30 mg/100g; morcilla (rica en
  // hierro) ~20 mg/100g. 60 cubre con margen cualquier fortificación real;
  // 1000 (=1 g de hierro en 100 g de producto) es un salto de otro orden.
  iron_mg: { suspiciousAboveMg: 60, impossibleAboveMg: 1000 },
  // Semillas de calabaza (muy densas en zinc) ~7-10 mg/100g; cereales
  // fortificados ~15 mg/100g. 30 da margen amplio; 300 no lo alcanza nada real.
  zinc_mg: { suspiciousAboveMg: 30, impossibleAboveMg: 300 },
  // Quesos curados (referencia, no vegana) ~1200 mg/100g; bebidas/tofu muy
  // fortificados no suelen superar unos cientos de mg/100g. 1500 cubre con
  // margen; 5000 (=5 g de calcio en 100 g) no lo alcanza ningún alimento.
  calcium_mg: { suspiciousAboveMg: 1500, impossibleAboveMg: 5000 },
  // RDA=15 mcg; los productos más fortificados (margarinas, bebidas
  // vegetales) rondan unos pocos a bajas decenas de mcg/100g. 50 da margen
  // amplio; 500 es un orden de magnitud fuera de cualquier fortificación real.
  vitamin_d_mcg: { suspiciousAboveMg: 50, impossibleAboveMg: 500 },
  // La levadura nutricional muy fortificada (el alimento vegetal más denso
  // en B12) puede rondar 100-200 mcg/100g. 200 cubre con margen; 2000 no lo
  // alcanza ningún alimento real, fortificado o no.
  vitamin_b12_mcg: { suspiciousAboveMg: 200, impossibleAboveMg: 2000 },
};

function checkMicronutrient(
  value: number | null,
  known: boolean,
  threshold: MicroThreshold
): NutrientCheck {
  if (!known || value === null) return { status: 'unknown' };
  if (value < 0) return negative();
  if (value > threshold.impossibleAboveMg) {
    return { status: 'impossible', reason: 'exceeds_realistic_fortification_ceiling' };
  }
  if (value > threshold.suspiciousAboveMg) {
    return { status: 'suspicious', reason: 'above_typical_fortified_range' };
  }
  return VALID;
}

/** Omega-3: OFF nunca lo alimenta hoy (siempre unknown por diseño); sin techo
 *  específico propio porque no hay ningún dato real con el que calibrarlo —
 *  sólo se comprueba lo universal (negativo → imposible). */
function checkOmega3(value: number | null, known: boolean): NutrientCheck {
  if (!known || value === null) return { status: 'unknown' };
  if (value < 0) return negative();
  return VALID;
}

export function validateProductNutrition(food: FoodPer100g): ProductNutritionValidation {
  const composition = checkMacroComposition(food.protein_g, food.carbs_g, food.fat_g);

  const fields: Record<ValidatedNutrientField, NutrientCheck> = {
    calories: checkEnergy(food.calories),
    protein_g: composition.protein,
    carbs_g: composition.carbs,
    fat_g: composition.fat,
    fiber_g: checkNonNegativeOnly(food.fiber_g),
    sugar_g: checkSubsetOf(food.sugar_g, food.carbs_g, 'sugar_exceeds_carbs'),
    saturated_fat_g: checkSubsetOf(food.saturated_fat_g, food.fat_g, 'saturated_fat_exceeds_fat'),
    sodium_mg: checkSodium(food.sodium_mg),
    vitamin_b12_mcg: checkMicronutrient(food.vitamin_b12_mcg, food.vitamin_b12_known, MICRO_THRESHOLDS.vitamin_b12_mcg),
    iron_mg: checkMicronutrient(food.iron_mg, food.iron_known, MICRO_THRESHOLDS.iron_mg),
    zinc_mg: checkMicronutrient(food.zinc_mg, food.zinc_known, MICRO_THRESHOLDS.zinc_mg),
    calcium_mg: checkMicronutrient(food.calcium_mg, food.calcium_known, MICRO_THRESHOLDS.calcium_mg),
    vitamin_d_mcg: checkMicronutrient(food.vitamin_d_mcg, food.vitamin_d_known, MICRO_THRESHOLDS.vitamin_d_mcg),
    omega3_g: checkOmega3(food.omega3_g, food.omega3_known),
  };

  const statuses = Object.values(fields).map((f) => f.status);
  const overall: ProductNutritionValidation['overall'] = statuses.includes('impossible')
    ? 'has_impossible'
    : statuses.includes('suspicious')
      ? 'has_suspicious'
      : 'clean';

  return { overall, fields };
}
