/**
 * Modelo de datos compartido con la PWA (vegantrack/src/types/index.ts).
 * Mantener sincronizado: ambas apps hablan con el mismo esquema Supabase.
 */

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'cut' | 'maintain' | 'bulk';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Sex = 'male' | 'female';

export interface Profile {
  id: string;
  display_name: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  birth_date: string | null; // YYYY-MM-DD
  sex: Sex | null;
  activity_level: ActivityLevel;
  goal: Goal;
  calorie_target: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  streak_count: number;
  last_log_date: string | null;
  created_at: string;
  updated_at: string;
  subscription_tier: 'free' | 'pro';
  subscription_expires_at: string | null;
  stripe_customer_id: string | null;
}

export interface FoodLogEntry {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  meal_type: MealType;
  food_name: string;
  barcode: string | null;
  brand: string | null;
  serving_size_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  saturated_fat_g: number;
  sodium_mg: number;
  vitamin_b12_mcg: number | null;
  iron_mg: number | null;
  zinc_mg: number | null;
  calcium_mg: number | null;
  omega3_g: number | null;
  vitamin_d_mcg: number | null;
  vitamin_b12_known: boolean;
  iron_known: boolean;
  zinc_known: boolean;
  calcium_known: boolean;
  omega3_known: boolean;
  vitamin_d_known: boolean;
  source?: string | null; // 'openfoodfacts' | 'recipe' | 'custom' | 'manual'
  source_ref?: string | null;
  is_vegan: boolean;
  image_url: string | null;
  created_at: string;
  updated_at?: string;
}

export interface OpenFoodFactsProduct {
  code: string;
  product_name: string;
  brands: string;
  image_front_url: string;
  categories_tags: string[];
  labels_tags: string[];
  nutriments: {
    'energy-kcal_100g': number;
    proteins_100g: number;
    carbohydrates_100g: number;
    fat_100g: number;
    fiber_100g: number;
    sugars_100g: number;
    'saturated-fat_100g': number;
    sodium_100g: number;
    'vitamin-b12_100g'?: number | null;
    iron_100g?: number | null;
    zinc_100g?: number | null;
    calcium_100g?: number | null;
    'vitamin-d_100g'?: number | null;
  };
  serving_size: string;
  serving_quantity: number;
}

export type VeganConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface MicroAggregate {
  value: number;
  knownEntries: number;
  totalEntries: number;
  coverage: number; // 0..1
}

export interface NutrientSummary {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  micros: {
    vitamin_b12_mcg: MicroAggregate;
    iron_mg: MicroAggregate;
    zinc_mg: MicroAggregate;
    calcium_mg: MicroAggregate;
    omega3_g: MicroAggregate;
    vitamin_d_mcg: MicroAggregate;
  };
}

export interface MealGroup {
  type: MealType;
  label: string;
  icon: string;
  entries: FoodLogEntry[];
  totals: NutrientSummary;
}

export interface RecentFood {
  food_name: string;
  barcode: string | null;
  brand: string | null;
  image_url: string | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  sugar_per_100g: number;
  saturated_fat_per_100g: number;
  sodium_per_100g: number;
  vitamin_b12_mcg_per_100g: number | null;
  iron_mg_per_100g: number | null;
  zinc_mg_per_100g: number | null;
  calcium_mg_per_100g: number | null;
  omega3_g_per_100g: number | null;
  vitamin_d_mcg_per_100g: number | null;
  vitamin_b12_known: boolean;
  iron_known: boolean;
  zinc_known: boolean;
  calcium_known: boolean;
  omega3_known: boolean;
  vitamin_d_known: boolean;
  is_vegan: boolean;
  last_serving_g: number;
  use_count: number;
}

export interface CustomFood {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  sugar_per_100g: number;
  saturated_fat_per_100g: number;
  sodium_mg_per_100g: number;
  vitamin_b12_mcg_per_100g: number | null;
  iron_mg_per_100g: number | null;
  zinc_mg_per_100g: number | null;
  calcium_mg_per_100g: number | null;
  vitamin_d_mcg_per_100g: number | null;
  omega3_g_per_100g: number | null;
  is_vegan: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeightLog {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number;
  note: string | null;
  created_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  food_name: string;
  brand: string | null;
  barcode: string | null;
  serving_size_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  sugar_per_100g: number;
  saturated_fat_per_100g: number;
  sodium_mg_per_100g: number;
  vitamin_b12_mcg_per_100g: number | null;
  iron_mg_per_100g: number | null;
  zinc_mg_per_100g: number | null;
  calcium_mg_per_100g: number | null;
  vitamin_d_mcg_per_100g: number | null;
  omega3_g_per_100g: number | null;
  vitamin_b12_known: boolean;
  iron_known: boolean;
  zinc_known: boolean;
  calcium_known: boolean;
  vitamin_d_known: boolean;
  omega3_known: boolean;
  is_vegan: boolean;
  image_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  total_servings: number;
  image_url: string | null;
  is_vegan: boolean;
  ingredients: RecipeIngredient[];
  created_at: string;
  updated_at: string;
}

export interface RecipeNutrients {
  total_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  saturated_fat_g: number;
  sodium_mg: number;
  vitamin_b12_mcg: number | null;
  iron_mg: number | null;
  zinc_mg: number | null;
  calcium_mg: number | null;
  vitamin_d_mcg: number | null;
  omega3_g: number | null;
  vitamin_b12_known: boolean;
  iron_known: boolean;
  zinc_known: boolean;
  calcium_known: boolean;
  vitamin_d_known: boolean;
  omega3_known: boolean;
}

export type SupplementNutrientKey =
  | 'vitamin_b12_mcg'
  | 'vitamin_d_mcg'
  | 'omega3_g'
  | 'iron_mg'
  | 'zinc_mg'
  | 'calcium_mg'
  | 'iodine_mcg';

export interface Supplement {
  id: string;
  user_id: string;
  name: string;
  nutrient_key: SupplementNutrientKey | null;
  emoji: string | null;
  dose_amount: number;
  dose_unit: string;
  frequency: 'daily';
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface SupplementLog {
  id: string;
  user_id: string;
  supplement_id: string;
  date: string;
  taken_at: string;
}

export interface VeganScorePart {
  score: number;
  max: number;
  label: string;
}

export interface VeganScoreBreakdown {
  total: number;
  calories: VeganScorePart;
  protein: VeganScorePart;
  micros: VeganScorePart;
  fiber: VeganScorePart;
  streak: VeganScorePart;
  hasData: boolean;
}

/** Alimento normalizado a valores por 100 g, listo para loguear en cualquier ración. */
export interface FoodPer100g {
  food_name: string;
  brand: string | null;
  barcode: string | null;
  image_url: string | null;
  is_vegan: boolean;
  source: string;
  source_ref?: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  saturated_fat_g: number;
  sodium_mg: number;
  vitamin_b12_mcg: number | null;
  iron_mg: number | null;
  zinc_mg: number | null;
  calcium_mg: number | null;
  omega3_g: number | null;
  vitamin_d_mcg: number | null;
  vitamin_b12_known: boolean;
  iron_known: boolean;
  zinc_known: boolean;
  calcium_known: boolean;
  omega3_known: boolean;
  vitamin_d_known: boolean;
}
