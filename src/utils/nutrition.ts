/**
 * Cálculo de objetivos nutricionales y agregación diaria.
 * Fórmulas idénticas a la PWA (vegantrack/src/utils/nutrition.ts) para que
 * un mismo perfil produzca exactamente los mismos objetivos en ambas apps.
 */
import type { FoodLogEntry, MicroAggregate, NutrientSummary, Profile, Sex } from '@/types';
import { applyOverrides, type NutrientOverride } from '@/lib/nutrientOverrides';

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;

const GOAL_ADJUSTMENTS = {
  cut: -500,
  maintain: 0,
  bulk: 300,
} as const;

/** RDAs mostradas en el dashboard. Hierro se ajusta por sexo (8 ♂ / 18 ♀). */
export const MICRO_RDA = {
  vitamin_b12_mcg: { label: 'Vitamina B12', rda: 2.4, unit: 'mcg' },
  iron_mg: { label: 'Hierro', rda: 18, unit: 'mg' },
  zinc_mg: { label: 'Zinc', rda: 11, unit: 'mg' },
  calcium_mg: { label: 'Calcio', rda: 1000, unit: 'mg' },
  vitamin_d_mcg: { label: 'Vitamina D', rda: 15, unit: 'mcg' },
  omega3_g: { label: 'Omega-3', rda: 1.6, unit: 'g' },
} as const;

export function ironRdaForSex(sex: Sex | null | undefined): number {
  return sex === 'male' ? 8 : 18;
}

/** BMR según Mifflin-St Jeor (más precisa que Harris-Benedict). */
function calculateBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === 'male' ? base + 5 : base - 161;
}

export function getAge(birthDate: string, ref: Date = new Date()): number {
  const birth = new Date(birthDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function calculateTDEE(profile: Partial<Profile>): number | null {
  const { weight_kg, height_cm, birth_date, sex, activity_level } = profile;
  if (!weight_kg || !height_cm || !birth_date || !sex || !activity_level) return null;

  const age = getAge(birth_date);
  const bmr = calculateBMR(weight_kg, height_cm, age, sex);
  return Math.round(bmr * ACTIVITY_MULTIPLIERS[activity_level]);
}

export function calculateTargets(profile: Partial<Profile>): {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
} | null {
  const tdee = calculateTDEE(profile);
  if (!tdee || !profile.goal || !profile.weight_kg) return null;

  const calories = tdee + GOAL_ADJUSTMENTS[profile.goal];

  // Proteína: 1.8 g/kg para veganos activos (digestibilidad de proteína vegetal)
  const protein_g = Math.round(profile.weight_kg * 1.8);
  // Grasa: 25% de las calorías
  const fat_g = Math.round((calories * 0.25) / 9);
  // Carbohidratos: el resto
  const carbs_g = Math.round((calories - protein_g * 4 - fat_g * 9) / 4);

  return { calories: Math.round(calories), protein_g, carbs_g, fat_g };
}

export function formatNumber(n: number): string {
  return n.toLocaleString('es-ES');
}

function makeMicro(): NutrientSummary['micros'][keyof NutrientSummary['micros']] {
  return {
    value: 0,
    knownEntries: 0,
    totalEntries: 0,
    coverage: 0,
    knownGrams: 0,
    totalGrams: 0,
    coverageByGrams: 0,
    hasEntries: false,
  };
}

/**
 * Agrega las entries de un día en un NutrientSummary.
 * Replica getDaySummary() del diaryStore de la PWA, incluida la semántica de
 * cobertura de micros: una entry manual sin micros conocidos no penaliza.
 *
 * Regla central del modelo, que NO debe romperse en ninguna modificación
 * futura de esta función: `value` es siempre la suma exacta de los aportes
 * CONOCIDOS, nunca se descarta ni se sustituye por 0 por baja cobertura. La
 * cobertura (por entradas y por gramos) se calcula y se expone por
 * separado, como metadato de confianza — nunca como una puerta que decide
 * si `value` se muestra o no. Esa decisión vive en `resolveMicroDisplay`,
 * en la capa de presentación, no aquí.
 */
export function summarizeEntries(
  entries: FoodLogEntry[],
  overrides: NutrientOverride[] = []
): NutrientSummary {
  const summary: NutrientSummary = {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    micros: {
      vitamin_b12_mcg: makeMicro(),
      iron_mg: makeMicro(),
      zinc_mg: makeMicro(),
      calcium_mg: makeMicro(),
      omega3_g: makeMicro(),
      vitamin_d_mcg: makeMicro(),
    },
  };

  for (const e of entries) {
    summary.calories += e.calories || 0;
    summary.protein_g += e.protein_g || 0;
    summary.carbs_g += e.carbs_g || 0;
    summary.fat_g += e.fat_g || 0;
    summary.fiber_g += e.fiber_g || 0;

    const enriched = { ...e, ...applyOverrides(e, overrides) };

    const microFields = [
      ['vitamin_b12_mcg', enriched.vitamin_b12_mcg, enriched.vitamin_b12_known],
      ['iron_mg', enriched.iron_mg, enriched.iron_known],
      ['zinc_mg', enriched.zinc_mg, enriched.zinc_known],
      ['calcium_mg', enriched.calcium_mg, enriched.calcium_known],
      ['omega3_g', enriched.omega3_g, enriched.omega3_known],
      ['vitamin_d_mcg', enriched.vitamin_d_mcg, enriched.vitamin_d_known],
    ] as const;

    for (const [key, value, known] of microFields) {
      const m = summary.micros[key];
      const isKnown = (known ?? false) && value !== null && value !== undefined;
      // Misma regla para entradas y para gramos: una entry manual sin dato no
      // cuenta contra la cobertura (nunca se esperó que trajera micros); el
      // resto de fuentes (OFF, frescos, foto IA, receta, propio) sí cuentan,
      // porque de ellas SÍ se espera que puedan traer el dato.
      const isRelevant = e.source !== 'manual' || isKnown;
      if (isRelevant) {
        m.totalEntries += 1;
        m.totalGrams += e.serving_size_g;
      }
      if (isKnown) {
        m.value += value as number;
        m.knownEntries += 1;
        m.knownGrams += e.serving_size_g;
      }
    }
  }

  for (const key of Object.keys(summary.micros) as Array<keyof NutrientSummary['micros']>) {
    const m = summary.micros[key];
    m.coverage = m.totalEntries > 0 ? m.knownEntries / m.totalEntries : 0;
    m.coverageByGrams = m.totalGrams > 0 ? m.knownGrams / m.totalGrams : 0;
    // hasEntries distingue "nada relevante registrado hoy para este
    // nutriente" (día vacío, estado neutro) de "registrado pero sin datos"
    // (coverage=0 con hasEntries=true) — nunca deben tratarse igual.
    m.hasEntries = m.totalEntries > 0;
  }

  return summary;
}

/** Escala un alimento por-100g a una ración concreta, con el redondeo de la PWA. */
export function scaleServing(per100: number, grams: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(((per100 * grams) / 100) * factor) / factor;
}

// ── Presentación de micronutrientes: known/unknown → confianza ─────────────
//
// Todo lo de aquí abajo es puro y no conoce React ni ningún componente. Es
// la capa que decide CÓMO presentar un MicroAggregate (nunca cómo agregarlo:
// eso es summarizeEntries) — el sitio correcto para la regla que sustituye al
// antiguo `coverage < 0.5 ? value : 0`, que no debe volver a aparecer en
// ningún consumidor (Dashboard, VeganScore, tendencias).

/**
 * Nivel de confianza en los datos de comida de un micronutriente, derivado
 * de `coverageByGrams`. Describe SÓLO la calidad del dato de comida — nunca
 * se ve afectado por el suplemento, que es una fuente aparte, siempre
 * conocida al 100%.
 *
 * 'none'  → hasEntries=false: no hay nada relevante registrado hoy para este
 *           nutriente. Es un estado neutro (día vacío), no una alarma.
 * 'low'   → hay registros pero coverageByGrams < 0.4.
 * 'medium'→ 0.4 <= coverageByGrams < 0.75.
 * 'high'  → coverageByGrams >= 0.75.
 */
export type MicroConfidence = 'none' | 'low' | 'medium' | 'high';

/** Orden de menor a mayor confianza, para comparar niveles sin números mágicos. */
const CONFIDENCE_ORDER: readonly MicroConfidence[] = ['none', 'low', 'medium', 'high'];

/**
 * Confianza mínima que exigirá VeganScore (Fase 2 — todavía no consumida por
 * ningún consumidor en este commit) para otorgar el crédito COMPLETO a un
 * micronutriente parcialmente conocido, salvo que el objetivo ya se cubra
 * sólo con el suplemento. Única constante con nombre: ningún archivo debe
 * repetir su propio umbral de confianza por separado.
 */
export const MIN_SCORE_CONFIDENCE: MicroConfidence = 'medium';

/** ¿`confidence` alcanza (o supera) el nivel mínimo `min`? */
export function meetsMinConfidence(confidence: MicroConfidence, min: MicroConfidence): boolean {
  return CONFIDENCE_ORDER.indexOf(confidence) >= CONFIDENCE_ORDER.indexOf(min);
}

const CONFIDENCE_MEDIUM_MIN = 0.4;
const CONFIDENCE_HIGH_MIN = 0.75;

/** Deriva el nivel de confianza de un agregado. Pura, sin efectos. */
export function microConfidence(agg: MicroAggregate): MicroConfidence {
  if (!agg.hasEntries) return 'none';
  if (agg.coverageByGrams >= CONFIDENCE_HIGH_MIN) return 'high';
  if (agg.coverageByGrams >= CONFIDENCE_MEDIUM_MIN) return 'medium';
  return 'low';
}

/**
 * Representación de presentación de un micronutriente para un día: cuánto se
 * conoce de comida, cuánto de suplemento, el total efectivo frente al RDA, y
 * la confianza en el dato de comida — todo por separado, nada precalculado
 * en una sola cifra que oculte de dónde viene.
 */
export interface MicroDisplay {
  /** Suma conocida de comida (= agg.value). Nunca se pone a 0 por baja cobertura. */
  knownFood: number;
  /** Aporte de suplementos tomados hoy para este nutriente. Siempre 100% conocido. */
  supplement: number;
  /** knownFood + supplement: la mejor estimación real del día. */
  known: number;
  /** RDA del nutriente para este usuario. */
  target: number;
  /** known / target. 0 si target <= 0 (sin objetivo configurado). */
  pct: number;
  /** Cobertura de comida por Nº de entradas (= agg.coverage). */
  coverage: number;
  /** Cobertura de comida por gramos (= agg.coverageByGrams). */
  coverageByGrams: number;
  /** Confianza derivada de coverageByGrams (ver microConfidence). */
  confidence: MicroConfidence;
  /** ¿Hay algo relevante registrado hoy para este nutriente? */
  hasEntries: boolean;
}

/**
 * Transforma un MicroAggregate (comida) + aporte de suplemento + RDA en una
 * representación de presentación. Es la única función que debe decidir "qué
 * mostrar" — Dashboard, VeganScore y las tendencias deben llamarla en vez de
 * reimplementar su propia regla de umbral (la causa raíz del bug original:
 * la misma regla `coverage < 0.5 ? value : 0` copiada tres veces).
 *
 * No decide NADA sobre representación visual (colores, texto, componentes):
 * sólo devuelve los números y la confianza ya separados.
 */
export function resolveMicroDisplay(
  agg: MicroAggregate,
  suppAmount: number,
  rda: number
): MicroDisplay {
  const knownFood = agg.value;
  const supplement = suppAmount;
  const known = knownFood + supplement;
  return {
    knownFood,
    supplement,
    known,
    target: rda,
    pct: rda > 0 ? known / rda : 0,
    coverage: agg.coverage,
    coverageByGrams: agg.coverageByGrams,
    confidence: microConfidence(agg),
    hasEntries: agg.hasEntries,
  };
}
