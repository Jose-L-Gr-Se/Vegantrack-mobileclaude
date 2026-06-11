/**
 * Overrides de micronutrientes (tabla `nutrient_overrides` de Supabase).
 * Enriquecen datos incompletos de OpenFoodFacts con valores USDA.
 * Igual que la PWA, con una mejora: la lista se cachea en SQLite para
 * funcionar offline entre sesiones.
 */
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';

export interface NutrientOverride {
  food_name_pattern: string;
  match_type: 'exact' | 'contains';
  vitamin_b12_mcg_per_100g: number | null;
  iron_mg_per_100g: number | null;
  zinc_mg_per_100g: number | null;
  calcium_mg_per_100g: number | null;
  vitamin_d_mcg_per_100g: number | null;
  omega3_g_per_100g: number | null;
}

const KV_KEY = 'nutrient_overrides';

let overridesCache: NutrientOverride[] | null = null;

export async function loadOverrides(): Promise<NutrientOverride[]> {
  if (overridesCache) return overridesCache;

  const { data, error } = await supabase
    .from('nutrient_overrides')
    .select(
      'food_name_pattern, match_type, vitamin_b12_mcg_per_100g, iron_mg_per_100g, zinc_mg_per_100g, calcium_mg_per_100g, vitamin_d_mcg_per_100g, omega3_g_per_100g'
    );

  if (error || !data) {
    const cached = await kvGet<NutrientOverride[]>(KV_KEY);
    overridesCache = cached ?? [];
    return overridesCache;
  }

  overridesCache = data as NutrientOverride[];
  void kvSet(KV_KEY, overridesCache);
  return overridesCache;
}

export function findOverride(
  foodName: string,
  overrides: NutrientOverride[]
): NutrientOverride | null {
  const nameLower = foodName.toLowerCase().trim();
  const exact = overrides.find(
    (o) => o.match_type === 'exact' && o.food_name_pattern === nameLower
  );
  if (exact) return exact;
  // contains: el patrón más específico (más largo) primero
  const matches = overrides
    .filter((o) => o.match_type === 'contains' && nameLower.includes(o.food_name_pattern))
    .sort((a, b) => b.food_name_pattern.length - a.food_name_pattern.length);
  return matches[0] ?? null;
}

/**
 * Factor de biodisponibilidad del hierro no hemo (vegetal).
 * Hierro hemo (animal) ≈ 25% absorción; no hemo ≈ 12%. 0.12/0.25 = 0.48.
 * Fuente: Hallberg & Hulthén, Am J Clin Nutr 2000.
 */
export const IRON_NONHEME_FACTOR = 0.48;

interface OverridableEntry {
  food_name: string;
  serving_size_g: number;
  vitamin_b12_mcg: number | null;
  vitamin_b12_known: boolean;
  iron_mg: number | null;
  iron_known: boolean;
  zinc_mg: number | null;
  zinc_known: boolean;
  calcium_mg: number | null;
  calcium_known: boolean;
  vitamin_d_mcg: number | null;
  vitamin_d_known: boolean;
  omega3_g: number | null;
  omega3_known: boolean;
}

export function applyOverrides<T extends OverridableEntry>(
  entry: T,
  overrides: NutrientOverride[]
): Partial<OverridableEntry> {
  const override = findOverride(entry.food_name, overrides);
  if (!override) return {};

  const ratio = entry.serving_size_g / 100;
  const result: Partial<OverridableEntry> = {};

  if (!entry.vitamin_b12_known && override.vitamin_b12_mcg_per_100g !== null) {
    result.vitamin_b12_mcg = Math.round(override.vitamin_b12_mcg_per_100g * ratio * 100) / 100;
    result.vitamin_b12_known = true;
  }
  if (!entry.iron_known && override.iron_mg_per_100g !== null) {
    result.iron_mg = Math.round(override.iron_mg_per_100g * ratio * 10) / 10;
    result.iron_known = true;
  }
  if (!entry.zinc_known && override.zinc_mg_per_100g !== null) {
    result.zinc_mg = Math.round(override.zinc_mg_per_100g * ratio * 10) / 10;
    result.zinc_known = true;
  }
  if (!entry.calcium_known && override.calcium_mg_per_100g !== null) {
    result.calcium_mg = Math.round(override.calcium_mg_per_100g * ratio * 10) / 10;
    result.calcium_known = true;
  }
  if (!entry.vitamin_d_known && override.vitamin_d_mcg_per_100g !== null) {
    result.vitamin_d_mcg = Math.round(override.vitamin_d_mcg_per_100g * ratio * 100) / 100;
    result.vitamin_d_known = true;
  }
  if (!entry.omega3_known && override.omega3_g_per_100g !== null) {
    result.omega3_g = Math.round(override.omega3_g_per_100g * ratio * 1000) / 1000;
    result.omega3_known = true;
  }

  return result;
}
