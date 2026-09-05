/**
 * P0 plausibilidad — cierre de la ruta recipeStore.logRecipe() (no pasa por
 * ProductDetailSheet.commit(), así que necesitaba su propio guard). Misma
 * semántica exacta, mismas funciones reutilizadas (validateProductNutrition
 * / isSafeToPersist), sin duplicar thresholds:
 *   - macro/energía/sodio impossible → NO se persiste la entry.
 *   - micronutriente impossible en solitario → SÍ se persiste, excluido
 *     campo a campo por el mecanismo ya existente en buildEntry().
 *   - suspicious → se permite guardar.
 *
 * Un solo ingrediente con serving_size_g=100 hace que sus valores per-100g
 * pasen intactos al `per100` final de la receta (total_g=100, factor 1:1),
 * así que los fixtures son directos: computeRecipeNutrients() no está en
 * duda aquí (ya cubierta en recipeStore.computeRecipeNutrients.test.ts).
 */
import { useRecipeStore } from '@/stores/recipeStore';
import { useDiaryStore } from '@/stores/diaryStore';
import type { Recipe, RecipeIngredient } from '@/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({
  useDiaryStore: { getState: jest.fn() },
}));

const mockAddEntry = jest.fn();

beforeEach(() => {
  mockAddEntry.mockReset();
  mockAddEntry.mockResolvedValue({ error: null });
  (useDiaryStore.getState as jest.Mock).mockReturnValue({ addEntry: mockAddEntry });
});

function makeIngredient(over: Partial<RecipeIngredient>): RecipeIngredient {
  return {
    id: 'ing-1',
    recipe_id: 'recipe-1',
    food_name: 'Ingrediente',
    brand: null,
    barcode: null,
    serving_size_g: 100,
    calories_per_100g: 100,
    protein_per_100g: 5,
    carbs_per_100g: 10,
    fat_per_100g: 2,
    fiber_per_100g: 1,
    sugar_per_100g: 1,
    saturated_fat_per_100g: 0.5,
    sodium_mg_per_100g: 50,
    vitamin_b12_mcg_per_100g: null,
    iron_mg_per_100g: null,
    zinc_mg_per_100g: null,
    calcium_mg_per_100g: null,
    vitamin_d_mcg_per_100g: null,
    omega3_g_per_100g: null,
    vitamin_b12_known: false,
    iron_known: false,
    zinc_known: false,
    calcium_known: false,
    vitamin_d_known: false,
    omega3_known: false,
    is_vegan: true,
    image_url: null,
    sort_order: 0,
    created_at: '',
    ...over,
  };
}

function makeRecipe(ingredients: RecipeIngredient[]): Recipe {
  return {
    id: 'recipe-1',
    user_id: 'user-1',
    name: 'Receta de prueba',
    description: null,
    total_servings: 1,
    image_url: null,
    is_vegan: true,
    ingredients,
    created_at: '',
    updated_at: '',
  };
}

describe('logRecipe — plausibilidad nutricional', () => {
  it('1. macro impossible (protein 40 + carbs 40 + fat 40 = 120 por 100 g) → NO se persiste la entry', async () => {
    const recipe = makeRecipe([
      makeIngredient({ protein_per_100g: 40, carbs_per_100g: 40, fat_per_100g: 40, serving_size_g: 100 }),
    ]);

    const { error } = await useRecipeStore.getState().logRecipe('user-1', recipe, 1, 'lunch', '2026-09-05');

    expect(error).not.toBeNull();
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('1b. energía imposible agregada de los ingredientes → NO se persiste la entry', async () => {
    const recipe = makeRecipe([
      makeIngredient({ calories_per_100g: 2000, protein_per_100g: 5, carbs_per_100g: 10, fat_per_100g: 2, serving_size_g: 100 }),
    ]);

    const { error } = await useRecipeStore.getState().logRecipe('user-1', recipe, 1, 'lunch', '2026-09-05');

    expect(error).not.toBeNull();
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('2. micronutriente impossible en solitario (hierro ×1000 vía agregación) → SÍ se persiste, excluido campo a campo', async () => {
    const recipe = makeRecipe([
      makeIngredient({
        protein_per_100g: 5, carbs_per_100g: 10, fat_per_100g: 2,
        iron_mg_per_100g: 14000, // agregado de ingredientes con error de unidad, mismo caso que el histórico
        iron_known: true,
        serving_size_g: 100,
      }),
    ]);

    const { error } = await useRecipeStore.getState().logRecipe('user-1', recipe, 1, 'lunch', '2026-09-05');

    expect(error).toBeNull();
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    const persistedEntry = mockAddEntry.mock.calls[0][0];
    // El resto de la entry se guarda con normalidad...
    expect(persistedEntry.protein_g).toBeCloseTo(5);
    // ...pero el hierro se excluye exactamente como "desconocido", nunca 0.
    expect(persistedEntry.iron_mg).toBeNull();
    expect(persistedEntry.iron_known).toBe(false);
  });

  it('3. suspicious (sodio 45.000 mg agregado) → se permite guardar', async () => {
    const recipe = makeRecipe([
      makeIngredient({ sodium_mg_per_100g: 45000, protein_per_100g: 5, carbs_per_100g: 10, fat_per_100g: 2, serving_size_g: 100 }),
    ]);

    const { error } = await useRecipeStore.getState().logRecipe('user-1', recipe, 1, 'lunch', '2026-09-05');

    expect(error).toBeNull();
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].sodium_mg).toBeCloseTo(45000);
  });

  it('receta totalmente normal → se guarda sin ningún aviso', async () => {
    const recipe = makeRecipe([
      makeIngredient({ protein_per_100g: 9, carbs_per_100g: 20, fat_per_100g: 0.4, calories_per_100g: 116, serving_size_g: 100 }),
    ]);

    const { error } = await useRecipeStore.getState().logRecipe('user-1', recipe, 1, 'lunch', '2026-09-05');

    expect(error).toBeNull();
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
  });
});
