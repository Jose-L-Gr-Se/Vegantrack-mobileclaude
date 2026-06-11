/**
 * Recetas con ingredientes anidados. Cálculo de nutrientes idéntico a la PWA:
 * se suman los ingredientes y se divide por raciones al loguear.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import { uuidv4 } from '@/utils/uuid';
import { useDiaryStore } from '@/stores/diaryStore';
import type { FoodPer100g, MealType, Recipe, RecipeIngredient, RecipeNutrients } from '@/types';
import { buildEntry } from '@/utils/foodEntry';

interface RecipeState {
  recipes: Recipe[];
  loading: boolean;
  fetchRecipes: (userId: string) => Promise<void>;
  createRecipe: (userId: string, name: string, description: string | null, totalServings: number) => Promise<{ error: string | null }>;
  updateRecipe: (id: string, patch: Partial<Pick<Recipe, 'name' | 'description' | 'total_servings'>>) => Promise<{ error: string | null }>;
  deleteRecipe: (id: string) => Promise<{ error: string | null }>;
  addIngredient: (recipeId: string, food: FoodPer100g, grams: number) => Promise<{ error: string | null }>;
  removeIngredient: (recipeId: string, ingredientId: string) => Promise<{ error: string | null }>;
  logRecipe: (userId: string, recipe: Recipe, servings: number, mealType: MealType, date: string) => Promise<{ error: string | null }>;
}

export function computeRecipeNutrients(recipe: Recipe): RecipeNutrients {
  const acc: RecipeNutrients = {
    total_g: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0,
    sugar_g: 0, saturated_fat_g: 0, sodium_mg: 0,
    vitamin_b12_mcg: null, iron_mg: null, zinc_mg: null, calcium_mg: null,
    vitamin_d_mcg: null, omega3_g: null,
    vitamin_b12_known: true, iron_known: true, zinc_known: true,
    calcium_known: true, vitamin_d_known: true, omega3_known: true,
  };

  for (const ing of recipe.ingredients) {
    const r = ing.serving_size_g / 100;
    acc.total_g += ing.serving_size_g;
    acc.calories += ing.calories_per_100g * r;
    acc.protein_g += ing.protein_per_100g * r;
    acc.carbs_g += ing.carbs_per_100g * r;
    acc.fat_g += ing.fat_per_100g * r;
    acc.fiber_g += ing.fiber_per_100g * r;
    acc.sugar_g += ing.sugar_per_100g * r;
    acc.saturated_fat_g += ing.saturated_fat_per_100g * r;
    acc.sodium_mg += ing.sodium_mg_per_100g * r;

    // Un micro de la receta solo es "conocido" si lo es en TODOS los ingredientes
    const micro = (
      key: 'vitamin_b12_mcg' | 'iron_mg' | 'zinc_mg' | 'calcium_mg' | 'vitamin_d_mcg' | 'omega3_g',
      knownKey: 'vitamin_b12_known' | 'iron_known' | 'zinc_known' | 'calcium_known' | 'vitamin_d_known' | 'omega3_known',
      per100: number | null,
      known: boolean
    ) => {
      if (!known || per100 === null) {
        acc[knownKey] = false;
        return;
      }
      acc[key] = (acc[key] ?? 0) + per100 * r;
    };
    micro('vitamin_b12_mcg', 'vitamin_b12_known', ing.vitamin_b12_mcg_per_100g, ing.vitamin_b12_known);
    micro('iron_mg', 'iron_known', ing.iron_mg_per_100g, ing.iron_known);
    micro('zinc_mg', 'zinc_known', ing.zinc_mg_per_100g, ing.zinc_known);
    micro('calcium_mg', 'calcium_known', ing.calcium_mg_per_100g, ing.calcium_known);
    micro('vitamin_d_mcg', 'vitamin_d_known', ing.vitamin_d_mcg_per_100g, ing.vitamin_d_known);
    micro('omega3_g', 'omega3_known', ing.omega3_g_per_100g, ing.omega3_known);
  }

  return acc;
}

export const useRecipeStore = create<RecipeState>((set, get) => ({
  recipes: [],
  loading: false,

  fetchRecipes: async (userId) => {
    set({ loading: true });
    const cached = await kvGet<Recipe[]>(`recipes:${userId}`);
    if (cached) set({ recipes: cached });

    const { data, error } = await supabase
      .from('recipes')
      .select('*, ingredients:recipe_ingredients(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const recipes = (data as Recipe[]).map((r) => ({
        ...r,
        ingredients: (r.ingredients ?? []).sort((a, b) => a.sort_order - b.sort_order),
      }));
      set({ recipes });
      void kvSet(`recipes:${userId}`, recipes);
    }
    set({ loading: false });
  },

  createRecipe: async (userId, name, description, totalServings) => {
    const id = uuidv4();
    const { error } = await supabase.from('recipes').insert({
      id,
      user_id: userId,
      name,
      description,
      total_servings: totalServings,
      is_vegan: true,
    });
    if (error) return { error: error.message };
    const now = new Date().toISOString();
    set({
      recipes: [
        { id, user_id: userId, name, description, total_servings: totalServings, image_url: null, is_vegan: true, ingredients: [], created_at: now, updated_at: now },
        ...get().recipes,
      ],
    });
    return { error: null };
  },

  updateRecipe: async (id, patch) => {
    const { error } = await supabase.from('recipes').update(patch).eq('id', id);
    if (error) return { error: error.message };
    set({ recipes: get().recipes.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
    return { error: null };
  },

  deleteRecipe: async (id) => {
    const prev = get().recipes;
    set({ recipes: prev.filter((r) => r.id !== id) });
    const { error } = await supabase.from('recipes').delete().eq('id', id);
    if (error) {
      set({ recipes: prev });
      return { error: error.message };
    }
    return { error: null };
  },

  addIngredient: async (recipeId, food, grams) => {
    const recipe = get().recipes.find((r) => r.id === recipeId);
    if (!recipe) return { error: 'Receta no encontrada' };

    const ing: RecipeIngredient = {
      id: uuidv4(),
      recipe_id: recipeId,
      food_name: food.food_name,
      brand: food.brand,
      barcode: food.barcode,
      serving_size_g: grams,
      calories_per_100g: food.calories,
      protein_per_100g: food.protein_g,
      carbs_per_100g: food.carbs_g,
      fat_per_100g: food.fat_g,
      fiber_per_100g: food.fiber_g,
      sugar_per_100g: food.sugar_g,
      saturated_fat_per_100g: food.saturated_fat_g,
      sodium_mg_per_100g: food.sodium_mg,
      vitamin_b12_mcg_per_100g: food.vitamin_b12_mcg,
      iron_mg_per_100g: food.iron_mg,
      zinc_mg_per_100g: food.zinc_mg,
      calcium_mg_per_100g: food.calcium_mg,
      vitamin_d_mcg_per_100g: food.vitamin_d_mcg,
      omega3_g_per_100g: food.omega3_g,
      vitamin_b12_known: food.vitamin_b12_known,
      iron_known: food.iron_known,
      zinc_known: food.zinc_known,
      calcium_known: food.calcium_known,
      vitamin_d_known: food.vitamin_d_known,
      omega3_known: food.omega3_known,
      is_vegan: food.is_vegan,
      image_url: food.image_url,
      sort_order: recipe.ingredients.length,
      created_at: new Date().toISOString(),
    };

    const { created_at, ...insertable } = ing;
    const { error } = await supabase.from('recipe_ingredients').insert(insertable);
    if (error) return { error: error.message };

    set({
      recipes: get().recipes.map((r) =>
        r.id === recipeId ? { ...r, ingredients: [...r.ingredients, ing] } : r
      ),
    });
    return { error: null };
  },

  removeIngredient: async (recipeId, ingredientId) => {
    const { error } = await supabase.from('recipe_ingredients').delete().eq('id', ingredientId);
    if (error) return { error: error.message };
    set({
      recipes: get().recipes.map((r) =>
        r.id === recipeId
          ? { ...r, ingredients: r.ingredients.filter((i) => i.id !== ingredientId) }
          : r
      ),
    });
    return { error: null };
  },

  logRecipe: async (userId, recipe, servings, mealType, date) => {
    if (recipe.total_servings <= 0) return { error: 'Raciones inválidas' };
    const totals = computeRecipeNutrients(recipe);
    if (totals.total_g <= 0) return { error: 'La receta no tiene ingredientes' };

    // Normalizamos la receta a "por 100 g" y la logueamos como una entry
    const gramsLogged = (totals.total_g / recipe.total_servings) * servings;
    const per100: FoodPer100g = {
      food_name: recipe.name,
      brand: 'Receta',
      barcode: null,
      image_url: recipe.image_url,
      is_vegan: recipe.is_vegan,
      source: 'recipe',
      source_ref: recipe.id,
      calories: (totals.calories / totals.total_g) * 100,
      protein_g: (totals.protein_g / totals.total_g) * 100,
      carbs_g: (totals.carbs_g / totals.total_g) * 100,
      fat_g: (totals.fat_g / totals.total_g) * 100,
      fiber_g: (totals.fiber_g / totals.total_g) * 100,
      sugar_g: (totals.sugar_g / totals.total_g) * 100,
      saturated_fat_g: (totals.saturated_fat_g / totals.total_g) * 100,
      sodium_mg: (totals.sodium_mg / totals.total_g) * 100,
      vitamin_b12_mcg: totals.vitamin_b12_known && totals.vitamin_b12_mcg !== null ? (totals.vitamin_b12_mcg / totals.total_g) * 100 : null,
      iron_mg: totals.iron_known && totals.iron_mg !== null ? (totals.iron_mg / totals.total_g) * 100 : null,
      zinc_mg: totals.zinc_known && totals.zinc_mg !== null ? (totals.zinc_mg / totals.total_g) * 100 : null,
      calcium_mg: totals.calcium_known && totals.calcium_mg !== null ? (totals.calcium_mg / totals.total_g) * 100 : null,
      omega3_g: totals.omega3_known && totals.omega3_g !== null ? (totals.omega3_g / totals.total_g) * 100 : null,
      vitamin_d_mcg: totals.vitamin_d_known && totals.vitamin_d_mcg !== null ? (totals.vitamin_d_mcg / totals.total_g) * 100 : null,
      vitamin_b12_known: totals.vitamin_b12_known,
      iron_known: totals.iron_known,
      zinc_known: totals.zinc_known,
      calcium_known: totals.calcium_known,
      omega3_known: totals.omega3_known,
      vitamin_d_known: totals.vitamin_d_known,
    };

    const entry = buildEntry(per100, Math.round(gramsLogged), mealType, date, userId);
    return useDiaryStore.getState().addEntry(entry);
  },
}));
