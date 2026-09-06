/**
 * Auditoría del paywall de foto-IA — cierre del P1: corrección manual y
 * gratuita de si un plato analizado por IA es vegano, distinta e
 * independiente del recálculo automático con IA (`correctMealAnalysis`,
 * que sigue siendo exclusivamente Pro).
 *
 * Mismo patrón de render que ProductDetailSheet.nutritionQuality.test.tsx
 * (react-test-renderer + act(), componente real, búsqueda por props
 * distintivos en vez de identidad de tipo/snapshot).
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import { correctMealAnalysis, type MealAnalysis } from '@/lib/mealVision';
import type { FoodPer100g } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));

// Mock parcial: `correctMealAnalysis` (la llamada de red, Pro) se mockea;
// `analysisToFood`/`correctVeganManually`/`manualVeganConfidence` (puras)
// se usan reales, igual que en el resto de tests de este componente.
jest.mock('@/lib/mealVision', () => ({
  ...jest.requireActual('@/lib/mealVision'),
  correctMealAnalysis: jest.fn(),
}));

const mockAddEntry = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockAddEntry.mockResolvedValue({ error: null });

  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' } })
  );
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    addEntry: mockAddEntry,
    deleteEntry: jest.fn(),
    selectedDate: '2026-09-05',
  });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

function aiPhotoFood(over: Partial<FoodPer100g>): FoodPer100g {
  return {
    food_name: 'Plato fotografiado',
    brand: 'Foto IA',
    barcode: null,
    image_url: null,
    is_vegan: true,
    source: 'ai_photo',
    source_ref: null,
    calories: 100,
    protein_g: 5,
    carbs_g: 10,
    fat_g: 2,
    fiber_g: 1,
    sugar_g: 1,
    saturated_fat_g: 0.5,
    sodium_mg: 0,
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
    ...over,
  };
}

function offFood(over: Partial<FoodPer100g>): FoodPer100g {
  return { ...aiPhotoFood({}), source: 'openfoodfacts', source_ref: '111', ...over };
}

function mealAnalysis(over: Partial<MealAnalysis> = {}): MealAnalysis {
  return {
    is_food: true,
    food_name: 'Plato fotografiado',
    estimated_grams: 100,
    per_100g: { calories: 100, protein_g: 5, carbs_g: 10, fat_g: 2, fiber_g: 1, sugar_g: 1, saturated_fat_g: 0.5 },
    is_vegan: true,
    vegan_confidence: 'high',
    non_vegan_ingredients: [],
    ...over,
  };
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderSheet(props: Partial<React.ComponentProps<typeof ProductDetailSheet>>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet onClose={() => {}} lockedMealType="lunch" {...props} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

/**
 * Localiza el Pressable cuyo subárbol contiene un Text con ese texto exacto.
 * `Pressable` de react-native es `React.memo(...)`; react-test-renderer
 * desenvuelve el memo y expone la función interna en el árbol de fibras, así
 * que se busca por `type.name` (mismo criterio que `findButtonByTitle` para
 * el `Button` propio de la app en el resto de tests de este componente), no
 * por identidad de referencia contra el `Pressable` importado.
 */
function findPressableWithText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root
    .findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Pressable')
    .find((p) => p.findAllByType(Text).some((t) => t.props.children === text));
}

function findNameInput(renderer: TestRenderer.ReactTestRenderer) {
  const [input] = renderer.root.findAll(
    (n) => n.type === TextInput && n.props.placeholder === 'Nombre del plato'
  );
  return input;
}

function pressSaveButton(renderer: TestRenderer.ReactTestRenderer) {
  const [saveButton] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      typeof n.props.onPress === 'function' &&
      (n.props.title === 'Añadir al diario' || n.props.title === 'Guardar cambios')
  );
  act(() => {
    void saveButton.props.onPress();
  });
}

describe('ProductDetailSheet — corrección manual de veganismo en foto-IA (auditoría del paywall, P1)', () => {
  it('1. Free + foto IA: puede marcar manualmente "No" aunque la IA dijera vegano, y se persiste', async () => {
    const food = aiPhotoFood({ is_vegan: true });
    const onVeganCorrected = jest.fn();
    const renderer = renderSheet({
      food,
      analysis: mealAnalysis({ is_vegan: true }),
      isPro: false,
      onVeganCorrected,
    });

    const noButton = findPressableWithText(renderer, 'No');
    expect(noButton).toBeDefined();
    act(() => noButton!.props.onPress());

    expect(onVeganCorrected).toHaveBeenCalledWith(false);
    expect(renderer.root.findAllByType(Text).some((t) => t.props.children === 'Vegano ✓')).toBe(false);

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].is_vegan).toBe(false);
  });

  it('1b. Free + foto IA: puede marcar manualmente "Sí" aunque la IA dijera no vegano, y se persiste', async () => {
    const food = aiPhotoFood({ is_vegan: false });
    const renderer = renderSheet({ food, analysis: mealAnalysis({ is_vegan: false }), isPro: false });

    const siButton = findPressableWithText(renderer, 'Sí');
    act(() => siButton!.props.onPress());

    expect(renderer.root.findAllByType(Text).some((t) => t.props.children === 'Vegano ✓')).toBe(true);

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry.mock.calls[0][0].is_vegan).toBe(true);
  });

  it('3. marcar "No" nunca llama a correctMealAnalysis (corrección gratis, sin IA)', () => {
    const food = aiPhotoFood({ is_vegan: true });
    const renderer = renderSheet({ food, analysis: mealAnalysis({ is_vegan: true }), isPro: true });

    const noButton = findPressableWithText(renderer, 'No');
    act(() => noButton!.props.onPress());

    expect(correctMealAnalysis).not.toHaveBeenCalled();
  });

  it('4. Pro: el recálculo automático sigue funcionando y sobrescribe una corrección manual previa', async () => {
    const food = aiPhotoFood({ is_vegan: false, food_name: 'Carne mechada' });
    (correctMealAnalysis as jest.Mock).mockResolvedValue({
      ok: true,
      analysis: mealAnalysis({
        food_name: 'Jaca (yaca) mechada',
        is_vegan: true,
        vegan_confidence: 'high',
        non_vegan_ingredients: [],
        per_100g: { calories: 90, protein_g: 3, carbs_g: 20, fat_g: 0.5, fiber_g: 4, sugar_g: 8, saturated_fat_g: 0.1 },
      }),
    });
    const onCorrected = jest.fn();
    const renderer = renderSheet({
      food,
      analysis: mealAnalysis({ is_vegan: false, food_name: 'Carne mechada' }),
      isPro: true,
      onCorrected,
    });

    // Corrección manual primero: el usuario marca "Sí" a mano.
    const siButton = findPressableWithText(renderer, 'Sí');
    act(() => siButton!.props.onPress());
    expect(renderer.root.findAllByType(Text).some((t) => t.props.children === 'Vegano ✓')).toBe(true);

    // Ahora corrige el nombre y pide el recálculo con IA (Pro) — debe poder
    // sobrescribir lo que el usuario acababa de marcar a mano.
    act(() => findNameInput(renderer).props.onChangeText('Jaca mechada'));
    const recalcButton = findPressableWithText(renderer, 'Recalcular macros con IA');
    expect(recalcButton).toBeDefined();
    await act(async () => {
      await recalcButton!.props.onPress();
    });

    expect(correctMealAnalysis).toHaveBeenCalledWith('Jaca mechada', expect.anything());
    expect(onCorrected).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType(Text).some((t) => t.props.children === 'Vegano ✓')).toBe(true);

    pressSaveButton(renderer);
    await act(async () => {});
    expect(mockAddEntry.mock.calls[0][0].is_vegan).toBe(true);
    expect(mockAddEntry.mock.calls[0][0].protein_g).toBeCloseTo(3);
  });

  it('5. Free: el botón de recálculo con IA sigue bloqueado (no se renderiza), y el control manual de veganismo sí', () => {
    const food = aiPhotoFood({ is_vegan: false });
    const renderer = renderSheet({ food, analysis: mealAnalysis({ is_vegan: false }), isPro: false });

    expect(findPressableWithText(renderer, 'Recalcular macros con IA')).toBeUndefined();
    expect(findPressableWithText(renderer, 'Sí')).toBeDefined();
    expect(findPressableWithText(renderer, 'No')).toBeDefined();
    // El texto de venta contextual del paywall sigue mostrándose.
    expect(
      renderer.root
        .findAllByType(Text)
        .some((t) => typeof t.props.children === 'string' && /Con Pro/.test(t.props.children))
    ).toBe(true);
  });

  it('6. producto normal (OFF/código de barras): no muestra el control de corrección de veganismo', () => {
    const food = offFood({ is_vegan: true });
    const renderer = renderSheet({ food, isPro: true });

    expect(findPressableWithText(renderer, 'Sí')).toBeUndefined();
    expect(findPressableWithText(renderer, 'No')).toBeUndefined();
    expect(
      renderer.root.findAllByType(Text).some((t) => t.props.children === '¿Es vegano?')
    ).toBe(false);
  });
});
