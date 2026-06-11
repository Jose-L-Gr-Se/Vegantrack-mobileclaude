/**
 * Cálculo de objetivos nutricionales y agregación diaria.
 * Fórmulas idénticas a la PWA (vegantrack/src/utils/nutrition.ts) para que
 * un mismo perfil produzca exactamente los mismos objetivos en ambas apps.
 */
import type { FoodLogEntry, NutrientSummary, Profile, Sex } from '@/types';
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

function makeMicro() {
  return { value: 0, knownEntries: 0, totalEntries: 0, coverage: 0 };
}

/**
 * Agrega las entries de un día en un NutrientSummary.
 * Replica getDaySummary() del diaryStore de la PWA, incluida la semántica de
 * cobertura de micros: una entry manual sin micros conocidos no penaliza.
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
      if (e.source !== 'manual' || isKnown) m.totalEntries += 1;
      if (isKnown) {
        m.value += value as number;
        m.knownEntries += 1;
      }
    }
  }

  for (const key of Object.keys(summary.micros) as Array<keyof NutrientSummary['micros']>) {
    const m = summary.micros[key];
    m.coverage = m.totalEntries > 0 ? m.knownEntries / m.totalEntries : 0;
  }

  return summary;
}

/** Escala un alimento por-100g a una ración concreta, con el redondeo de la PWA. */
export function scaleServing(per100: number, grams: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(((per100 * grams) / 100) * factor) / factor;
}
