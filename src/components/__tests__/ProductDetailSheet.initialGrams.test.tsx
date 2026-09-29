/**
 * Auditoría de fricción del registro recurrente — `ProductDetailSheet` debe
 * usar `initialGrams` como valor inicial de la cantidad (para precargar la
 * última ración usada al tocar un Reciente en `SearchScreen`), sin que nada
 * lo sobrescriba de vuelta a 100 g, y sin perder la edición manual. El
 * cableado en `SearchScreen` (qué aperturas pasan `initialGrams` y cuáles
 * no) se prueba aparte en `SearchScreen.recentInitialGrams.test.tsx`.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import type { FoodPer100g } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));

const mockAddEntry = jest.fn();

beforeEach(() => {
  mockAddEntry.mockReset();
  mockAddEntry.mockResolvedValue({ error: null });
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' } })
  );
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    addEntry: mockAddEntry,
    selectedDate: '2026-09-25',
  });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

const FOOD: FoodPer100g = {
  food_name: 'Lentejas estofadas',
  brand: null,
  barcode: null,
  image_url: null,
  is_vegan: true,
  source: 'manual',
  source_ref: null,
  calories: 116,
  protein_g: 9,
  carbs_g: 20,
  fat_g: 0.4,
  fiber_g: 7.9,
  sugar_g: 1.8,
  saturated_fat_g: 0.1,
  sodium_mg: 2,
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

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(initialGrams?: number) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet food={FOOD} initialGrams={initialGrams} onClose={() => {}} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

/** El único `TextInput` numérico de cantidad: placeholder "100", teclado numérico. */
function gramsInput(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) => n.type === TextInput && n.props.keyboardType === 'numeric' && n.props.placeholder === '100'
  )[0];
}

describe('ProductDetailSheet — initialGrams (precarga de la última ración)', () => {
  it('con initialGrams, la cantidad arranca en ese valor, no en 100', () => {
    const renderer = render(250);
    expect(gramsInput(renderer).props.value).toBe('250');
  });

  it('sin initialGrams, sigue cayendo al default de siempre (100)', () => {
    const renderer = render(undefined);
    expect(gramsInput(renderer).props.value).toBe('100');
  });

  it('initialGrams no se sobrescribe solo: sigue en el valor precargado tras un re-render', () => {
    const renderer = render(180);
    act(() => {
      renderer.update(
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
          <ProductDetailSheet food={FOOD} initialGrams={180} onClose={() => {}} />
        </SafeAreaProvider>
      );
    });
    expect(gramsInput(renderer).props.value).toBe('180');
  });

  it('la edición manual de la cantidad sigue funcionando con initialGrams precargado', async () => {
    // `lockedMealType` evita depender aquí de elegir comida (no es el objeto
    // de este test) — el flujo real de Recientes no bloquea la comida, pero
    // eso ya está cubierto por el resto de la suite de ProductDetailSheet.
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
          <ProductDetailSheet food={FOOD} initialGrams={180} lockedMealType="lunch" onClose={() => {}} />
        </SafeAreaProvider>
      );
    });
    act(() => {
      gramsInput(renderer).props.onChangeText('75');
    });
    expect(gramsInput(renderer).props.value).toBe('75');

    // El guardado usa el valor editado a mano (75), no el precargado (180).
    const [saveButton] = renderer.root.findAll(
      (n) =>
        typeof n.type === 'function' &&
        (n.type as { name?: string }).name === 'Button' &&
        typeof n.props.onPress === 'function' &&
        n.props.title === 'Añadir al diario'
    );
    await act(async () => {
      await saveButton.props.onPress();
    });
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].serving_size_g).toBe(75);
  });
});
