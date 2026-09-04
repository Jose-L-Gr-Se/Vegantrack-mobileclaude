/**
 * Construye un FoodLogEntry a partir de un alimento por-100g y una ración.
 * Redondeos idénticos a la PWA: kcal y sodio enteros; macros 1 decimal;
 * B12/VitD 2 decimales; Fe/Zn/Ca 1 decimal; Omega-3 3 decimales.
 */
import type { FoodLogEntry, FoodPer100g, MealType } from '@/types';
import { uuidv4 } from '@/utils/uuid';
import { validateProductNutrition } from '@/utils/productNutritionValidation';

function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

function scaleOrNull(per100: number | null, ratio: number, decimals: number): number | null {
  if (per100 === null) return null;
  return round(per100 * ratio, decimals);
}

export type NewFoodLogEntry = Omit<FoodLogEntry, 'created_at' | 'updated_at'>;

export function buildEntry(
  food: FoodPer100g,
  grams: number,
  mealType: MealType,
  date: string,
  userId: string
): NewFoodLogEntry {
  const ratio = grams / 100;

  // Un micronutriente 'impossible' (p. ej. el caso de la auditoría: hierro
  // introducido en la unidad equivocada y multiplicado ×1000) no debe
  // contaminar food_log/summarizeEntries/VeganScore/tendencias — pero
  // tampoco debe convertirse en 0 en silencio. Se trata exactamente igual
  // que un dato que OFF nunca reportó: null + *_known=false, el mismo
  // mecanismo que ya existe y que el resto del motor nutricional ya sabe
  // interpretar como "no cuenta para la cobertura", sin tocar
  // summarizeEntries/VeganScore/tendencias. Las macros no tienen hoy una
  // representación de "desconocido" en food_log (son NOT NULL) — quedan
  // fuera de este guard, ver nota en productNutritionValidation.ts.
  const quality = validateProductNutrition(food);
  const isUsable = (field: keyof typeof quality.fields) => quality.fields[field].status !== 'impossible';

  const b12 = scaleOrNull(food.vitamin_b12_known && isUsable('vitamin_b12_mcg') ? food.vitamin_b12_mcg : null, ratio, 2);
  const iron = scaleOrNull(food.iron_known && isUsable('iron_mg') ? food.iron_mg : null, ratio, 1);
  const zinc = scaleOrNull(food.zinc_known && isUsable('zinc_mg') ? food.zinc_mg : null, ratio, 1);
  const calcium = scaleOrNull(food.calcium_known && isUsable('calcium_mg') ? food.calcium_mg : null, ratio, 1);
  const omega3 = scaleOrNull(food.omega3_known && isUsable('omega3_g') ? food.omega3_g : null, ratio, 3);
  const vitD = scaleOrNull(food.vitamin_d_known && isUsable('vitamin_d_mcg') ? food.vitamin_d_mcg : null, ratio, 2);

  return {
    id: uuidv4(),
    user_id: userId,
    date,
    meal_type: mealType,
    food_name: food.food_name,
    barcode: food.barcode,
    brand: food.brand,
    serving_size_g: grams,
    calories: Math.round(food.calories * ratio),
    protein_g: round(food.protein_g * ratio, 1),
    carbs_g: round(food.carbs_g * ratio, 1),
    fat_g: round(food.fat_g * ratio, 1),
    fiber_g: round(food.fiber_g * ratio, 1),
    sugar_g: round(food.sugar_g * ratio, 1),
    saturated_fat_g: round(food.saturated_fat_g * ratio, 1),
    sodium_mg: Math.round(food.sodium_mg * ratio),
    vitamin_b12_mcg: b12,
    iron_mg: iron,
    zinc_mg: zinc,
    calcium_mg: calcium,
    omega3_g: omega3,
    vitamin_d_mcg: vitD,
    vitamin_b12_known: b12 !== null,
    iron_known: iron !== null,
    zinc_known: zinc !== null,
    calcium_known: calcium !== null,
    omega3_known: omega3 !== null,
    vitamin_d_known: vitD !== null,
    source: food.source,
    source_ref: food.source_ref ?? null,
    is_vegan: food.is_vegan,
    image_url: food.image_url,
  };
}
