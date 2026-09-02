/**
 * Fase 1 del P0 de micronutrientes — Paso 5.
 *
 * Este fichero NO cambia `computeRecipeNutrients` ni la persistencia de
 * recetas: sólo documenta, con tests, su comportamiento REAL de hoy, como
 * base para decidir la Fase 2 (ver docs/NUTRICION-MICRONUTRIENTES.md).
 *
 * Hallazgo relevante para el diseño, confirmado aquí con tests: la función
 * YA acumula la suma parcial de los ingredientes conocidos en `acc[key]`
 * incluso cuando `acc[knownKey]` acaba en `false` por culpa de otro
 * ingrediente. El helper interno `micro()` sólo hace `return` anticipado
 * (sin sumar) para el ingrediente sin dato — nunca reinicia ni descarta lo ya
 * acumulado de ingredientes anteriores. La suma parcial existe en memoria;
 * lo que la descarta es un paso POSTERIOR y distinto: `logRecipe()` (fuera
 * de este fichero), que sólo usa `totals[key]` cuando `totals[knownKey]` es
 * `true`, y si no, persiste `null`. Ese descarte no se toca en la Fase 1.
 */
import { computeRecipeNutrients } from '@/stores/recipeStore';
import type { Recipe, RecipeIngredient } from '@/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

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
    total_servings: 4,
    image_url: null,
    is_vegan: true,
    ingredients,
    created_at: '',
    updated_at: '',
  };
}

describe('computeRecipeNutrients · comportamiento actual (documentado, sin cambios)', () => {
  it('todos los ingredientes con hierro conocido: suma completa y known=true', () => {
    const recipe = makeRecipe([
      makeIngredient({ iron_mg_per_100g: 5, iron_known: true, serving_size_g: 100 }),
      makeIngredient({ iron_mg_per_100g: 3, iron_known: true, serving_size_g: 100 }),
    ]);
    const totals = computeRecipeNutrients(recipe);
    expect(totals.iron_mg).toBe(8);
    expect(totals.iron_known).toBe(true);
  });

  it('un ingrediente sin dato: iron_known pasa a false, PERO la suma parcial de los conocidos se conserva en acc.iron_mg', () => {
    const recipe = makeRecipe([
      makeIngredient({ iron_mg_per_100g: 5, iron_known: true, serving_size_g: 100 }), // aporta 5
      makeIngredient({ iron_mg_per_100g: 3, iron_known: true, serving_size_g: 100 }), // aporta 3
      makeIngredient({ iron_mg_per_100g: null, iron_known: false, serving_size_g: 50 }), // sin dato
    ]);
    const totals = computeRecipeNutrients(recipe);

    // Esto es lo que hoy ya ocurre y hay que documentar: known=false...
    expect(totals.iron_known).toBe(false);
    // ...pero acc.iron_mg NO es null ni 0: conserva 5+3=8, la suma de los
    // ingredientes que SÍ tenían dato. La información no se pierde aquí.
    expect(totals.iron_mg).toBe(8);
  });

  it('el orden de los ingredientes no importa: la suma parcial es la misma', () => {
    const conocidoPrimero = computeRecipeNutrients(
      makeRecipe([
        makeIngredient({ iron_mg_per_100g: 5, iron_known: true, serving_size_g: 100 }),
        makeIngredient({ iron_mg_per_100g: null, iron_known: false, serving_size_g: 50 }),
        makeIngredient({ iron_mg_per_100g: 3, iron_known: true, serving_size_g: 100 }),
      ])
    );
    const desconocidoPrimero = computeRecipeNutrients(
      makeRecipe([
        makeIngredient({ iron_mg_per_100g: null, iron_known: false, serving_size_g: 50 }),
        makeIngredient({ iron_mg_per_100g: 5, iron_known: true, serving_size_g: 100 }),
        makeIngredient({ iron_mg_per_100g: 3, iron_known: true, serving_size_g: 100 }),
      ])
    );
    expect(conocidoPrimero.iron_mg).toBe(8);
    expect(desconocidoPrimero.iron_mg).toBe(8);
  });

  it('caso del diseño (G): receta de 8 ingredientes, 2 sin datos de hierro', () => {
    const conocidos = [4, 3, 2, 1, 5, 2]; // 6 ingredientes con dato, 100 g cada uno
    const recipe = makeRecipe([
      ...conocidos.map((mg) => makeIngredient({ iron_mg_per_100g: mg, iron_known: true, serving_size_g: 100 })),
      makeIngredient({ iron_mg_per_100g: null, iron_known: false, serving_size_g: 100 }),
      makeIngredient({ iron_mg_per_100g: null, iron_known: false, serving_size_g: 100 }),
    ]);
    const totals = computeRecipeNutrients(recipe);

    expect(recipe.ingredients).toHaveLength(8);
    expect(totals.iron_known).toBe(false); // el flag persistible sigue siendo todo-o-nada
    expect(totals.iron_mg).toBe(conocidos.reduce((a, b) => a + b, 0)); // 17 — la suma de los 6 conocidos, no se pierde
    expect(totals.total_g).toBe(800); // los 8 ingredientes sí cuentan para el peso total de la receta
  });

  it('cada micronutriente es independiente: hierro conocido no implica B12 conocida', () => {
    const recipe = makeRecipe([
      makeIngredient({
        iron_mg_per_100g: 5, iron_known: true,
        vitamin_b12_mcg_per_100g: null, vitamin_b12_known: false,
        serving_size_g: 100,
      }),
    ]);
    const totals = computeRecipeNutrients(recipe);
    expect(totals.iron_known).toBe(true);
    expect(totals.iron_mg).toBe(5);
    expect(totals.vitamin_b12_known).toBe(false);
    expect(totals.vitamin_b12_mcg).toBeNull();
  });

  it('receta sin ingredientes: known=true por defecto (vacuamente), total_g=0', () => {
    // No hay ningún ingrediente que falle, así que el flag queda en su valor
    // inicial `true`. Caso límite a tener presente: una receta vacía no debe
    // interpretarse como "0 mg de hierro conocidos", sino como "sin datos
    // todavía" en cualquier consumidor futuro (RecipesScreen no se toca en
    // esta fase, pero queda documentado aquí para la Fase 2).
    const totals = computeRecipeNutrients(makeRecipe([]));
    expect(totals.total_g).toBe(0);
    expect(totals.iron_known).toBe(true);
    expect(totals.iron_mg).toBeNull();
  });
});
