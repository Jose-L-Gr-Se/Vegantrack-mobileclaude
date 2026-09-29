/**
 * Auditoría del flujo de recetas — ni "Añadir a la receta" ni "Añadir al
 * diario" (dentro de `RecipeDetail`) tenían protección contra doble tap, a
 * diferencia de `create()` en la lista de recetas (`RecipesScreen`), ya
 * corregido en una ronda anterior (ver `RecipesScreen.doubleTapLimit.test.tsx`).
 *
 * Dos toques rápidos en "Añadir a la receta" (antes de que el primero
 * resolviera) llamaban a `store.addIngredient()` dos veces con el MISMO
 * alimento y cantidad — insertando el ingrediente por duplicado, doblando su
 * aporte en `computeRecipeNutrients()` de forma permanente hasta quitarlo a
 * mano. Dos toques en "Añadir al diario" llamaban a `store.logRecipe()` dos
 * veces — cada una crea su propia entry en el Diario (id nuevo vía
 * `buildEntry()`), doblando las calorías de esa comida.
 *
 * Mismo arnés que `RecipesScreen.doubleTapLimit.test.tsx`, montando
 * `RecipeDetail` directamente (exportado sólo para tests, mismo criterio que
 * `CustomFoodModal` en `ProfileScreen.tsx`).
 */
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { RecipeDetail } from '@/screens/RecipesScreen';
import { useAuthStore } from '@/stores/authStore';
import { useRecipeStore } from '@/stores/recipeStore';
import type { Recipe, RecipeIngredient } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));

jest.mock('@/stores/recipeStore', () => ({
  useRecipeStore: jest.fn(),
  computeRecipeNutrients: (...args: unknown[]) =>
    jest.requireActual('@/stores/recipeStore').computeRecipeNutrients(...args),
}));

// Un único ingrediente "fresco" siempre disponible, sin pasar por una
// búsqueda real de OpenFoodFacts — sólo hace falta un FoodPer100g estable.
const FIXED_FOOD = {
  food_name: 'Manzana',
  brand: null,
  barcode: null,
  image_url: null,
  is_vegan: true,
  source: 'manual' as const,
  source_ref: null,
  calories: 52,
  protein_g: 0.3,
  carbs_g: 14,
  fat_g: 0.2,
  fiber_g: 2.4,
  sugar_g: 10,
  saturated_fat_g: 0,
  sodium_mg: 1,
  vitamin_b12_mcg: null,
  iron_mg: null,
  zinc_mg: null,
  calcium_mg: null,
  omega3_g: null,
  vitamin_d_mcg: null,
  vitamin_b12_known: false,
  iron_known: false,
  zinc_known: false,
  calcium_known: false,
  omega3_known: false,
  vitamin_d_known: false,
};

jest.mock('@/lib/freshProduce', () => ({
  searchFreshProduce: () => [{ id: 'fresh-1', name: 'Manzana', emoji: '🍎' }],
  freshItemToProduct: (item: unknown) => item,
}));
jest.mock('@/lib/openfoodfacts', () => ({
  searchProducts: jest.fn().mockResolvedValue({ products: [] }),
  normalizeProduct: (x: unknown) => x,
  productToFoodPer100g: () => FIXED_FOOD,
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn(() => ({ isPro: false })), FREE_RECIPE_LIMIT: 3 }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    user_id: 'user-1',
    name: 'Ensalada',
    description: null,
    total_servings: 2,
    image_url: null,
    is_vegan: true,
    ingredients: [] as RecipeIngredient[],
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function renderDetail(r: Recipe) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <RecipeDetail recipe={r} onBack={jest.fn()} topInset={0} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function findButtonByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  const [button] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      n.props.title === title
  );
  return button;
}

function findPressableByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  const candidates = renderer.root.findAll((n) => typeof n.props.onPress === 'function');
  const match = candidates.find((n) =>
    n.findAll((child) => {
      if ((child.type as unknown as string) !== 'Text') return false;
      const c = child.props.children;
      const flat = Array.isArray(c) ? c.join('') : c;
      return typeof flat === 'string' && flat.includes(text);
    }).length > 0
  );
  if (!match) throw new Error(`No se encontró ningún Pressable con texto "${text}"`);
  return match;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('RecipeDetail — doble tap en "Añadir a la receta" no debe duplicar el ingrediente', () => {
  it('dos toques rápidos, antes de que el primero resuelva, sólo llaman a addIngredient una vez', async () => {
    let resolveAdd!: (v: { error: null }) => void;
    const addIngredient = jest.fn(() => new Promise((resolve) => { resolveAdd = resolve; }));
    (useRecipeStore as unknown as jest.Mock).mockReturnValue({ addIngredient, logRecipe: jest.fn() });

    const renderer = renderDetail(recipe());

    // Selecciona el ingrediente "fresco" fijo → pendingFood queda listo.
    act(() => findPressableByText(renderer, 'Manzana').props.onPress());

    act(() => { findButtonByTitle(renderer, 'Añadir a la receta').props.onPress(); });
    act(() => { findButtonByTitle(renderer, 'Añadir a la receta').props.onPress(); });
    await act(async () => {
      resolveAdd({ error: null });
      await Promise.resolve();
    });

    expect(addIngredient).toHaveBeenCalledTimes(1);
  });

  it('comportamiento normal (sin doble tap) sigue intacto', async () => {
    const addIngredient = jest.fn().mockResolvedValue({ error: null });
    (useRecipeStore as unknown as jest.Mock).mockReturnValue({ addIngredient, logRecipe: jest.fn() });

    const renderer = renderDetail(recipe());
    act(() => findPressableByText(renderer, 'Manzana').props.onPress());
    await act(async () => {
      await findButtonByTitle(renderer, 'Añadir a la receta').props.onPress();
    });

    expect(addIngredient).toHaveBeenCalledTimes(1);
  });
});

describe('RecipeDetail — doble tap en "Añadir al diario" no debe registrar la receta dos veces', () => {
  it('dos toques rápidos, antes de que el primero resuelva, sólo llaman a logRecipe una vez', async () => {
    let resolveLog!: (v: { error: null }) => void;
    const logRecipe = jest.fn(() => new Promise((resolve) => { resolveLog = resolve; }));
    (useRecipeStore as unknown as jest.Mock).mockReturnValue({ addIngredient: jest.fn(), logRecipe });

    const withIngredient = recipe({
      ingredients: [
        {
          id: 'i1', recipe_id: 'r1', food_name: 'Manzana', brand: null, barcode: null,
          serving_size_g: 100, calories_per_100g: 52, protein_per_100g: 0.3, carbs_per_100g: 14,
          fat_per_100g: 0.2, fiber_per_100g: 2.4, sugar_per_100g: 10, saturated_fat_per_100g: 0,
          sodium_mg_per_100g: 1, vitamin_b12_mcg_per_100g: null, iron_mg_per_100g: null,
          zinc_mg_per_100g: null, calcium_mg_per_100g: null, vitamin_d_mcg_per_100g: null,
          omega3_g_per_100g: null, vitamin_b12_known: false, iron_known: false, zinc_known: false,
          calcium_known: false, vitamin_d_known: false, omega3_known: false, is_vegan: true,
          image_url: null, sort_order: 0, created_at: '',
        } as RecipeIngredient,
      ],
    });

    const renderer = renderDetail(withIngredient);
    // Abre la hoja de registro ("🍽️ Añadir al diario"), distinta del botón
    // de envío dentro de ella ("Añadir al diario", sin emoji).
    act(() => findButtonByTitle(renderer, '🍽️ Añadir al diario').props.onPress());

    act(() => { findButtonByTitle(renderer, 'Añadir al diario').props.onPress(); });
    act(() => { findButtonByTitle(renderer, 'Añadir al diario').props.onPress(); });
    await act(async () => {
      resolveLog({ error: null });
      await Promise.resolve();
    });

    expect(logRecipe).toHaveBeenCalledTimes(1);
  });
});
