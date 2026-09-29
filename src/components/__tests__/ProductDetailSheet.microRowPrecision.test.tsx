/**
 * Auditoría de cantidades y escalado nutricional — `MicroRow` decidía cuántos
 * decimales mostrar según la MAGNITUD del valor ya escalado (`<1`→2
 * decimales, `<10`→1, `≥10`→ninguno, redondeado a entero), no según la
 * precisión con la que `buildEntry()` va a persistir ESE campo en
 * `food_log` (fibra/azúcares/grasa saturada/hierro/zinc/calcio: siempre 1
 * decimal; B12/vitamina D: siempre 2 — sea cual sea la magnitud, ver
 * `foodEntry.ts`). El resultado: en cuanto una ración escalaba cualquiera de
 * esos campos a 10 o más, la ficha lo mostraba redondeado a un número
 * ENTERO distinto del que de verdad se iba a guardar.
 *
 * Caso reproducible (el mismo que demuestra el informe de esta ronda):
 * un alimento con 12,7 g de azúcares y 6,2 mg de hierro por 100 g, registrado
 * a 200 g (escala ×2):
 *   - Azúcares: 12,7×2 = 25,4 → buildEntry() persiste 25,4 g exactos, pero
 *     la ficha mostraba "25 g" (Math.round(25.4)).
 *   - Hierro: 6,2×2 = 12,4 → buildEntry() persiste 12,4 mg exactos, pero la
 *     ficha mostraba "12 mg".
 * Un tercer caso (B12, sin llegar a magnitud ≥10) demuestra el mismo defecto
 * en su otra forma: `buildEntry()` persiste B12 a 2 decimales SIEMPRE, pero
 * la ficha antigua sólo mostraba 1 decimal para cualquier valor ≥1.
 *
 * Mismo arnés que `ProductDetailSheet.editEntry.test.tsx`/
 * `.nutritionQuality.test.tsx` (react-test-renderer + act(), componente real).
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
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
    selectedDate: '2026-09-28',
  });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

// Per 100 g. Macros elegidas para pasar validateProductNutrition sin avisos
// (proteína+carbohidratos+grasa muy por debajo de 100 g, azúcares/grasa
// saturada por debajo de sus padres, hierro por debajo del umbral
// "sospechoso") — el objeto de este test es el redondeo de presentación, no
// la plausibilidad nutricional, ya cubierta aparte.
const FOOD: FoodPer100g = {
  food_name: 'Barrita de cereales',
  brand: null,
  barcode: null,
  image_url: null,
  is_vegan: true,
  source: 'manual',
  source_ref: null,
  calories: 90,
  protein_g: 3,
  carbs_g: 15,
  fat_g: 2,
  fiber_g: 2,
  sugar_g: 12.7,
  saturated_fat_g: 0.5,
  sodium_mg: 50,
  vitamin_b12_mcg: 2.474,
  iron_mg: 6.2,
  zinc_mg: null,
  calcium_mg: null,
  omega3_g: null,
  vitamin_d_mcg: null,
  vitamin_b12_known: true,
  iron_known: true,
  zinc_known: false,
  calcium_known: false,
  omega3_known: false,
  vitamin_d_known: false,
};

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function gramsInput(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) => n.type === TextInput && n.props.keyboardType === 'numeric' && n.props.placeholder === '100'
  )[0];
}

/** Todo el texto (aplanado) de los nodos <Text>, para buscar por subcadena
 *  sin depender de cómo se trocean los children de un <Text> concreto. */
function allText(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}

function render() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet food={FOOD} lockedMealType="lunch" onClose={() => {}} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

describe('ProductDetailSheet — el detalle por ración debe mostrar exactamente lo que se va a guardar en food_log', () => {
  it('azúcares ≥10 (200 g → 25,4 g): muestra "25.4 g", no "25 g"', async () => {
    const renderer = render();
    act(() => gramsInput(renderer).props.onChangeText('200'));

    const texts = allText(renderer);
    expect(texts).toContain('25.4 g');
    expect(texts).not.toContain('25 g');

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
    // Lo que muestra la ficha (25,4 g) coincide con lo que de verdad se guarda.
    expect(mockAddEntry.mock.calls[0][0].sugar_g).toBe(25.4);
  });

  it('hierro ≥10 (200 g → 12,4 mg): muestra "12.4 mg", no "12 mg"', () => {
    const renderer = render();
    act(() => gramsInput(renderer).props.onChangeText('200'));

    const texts = allText(renderer);
    expect(texts).toContain('12.4 mg');
    expect(texts).not.toContain('12 mg');
  });

  it('B12 entre 1 y 10 (200 g → 4,95 mcg): muestra los 2 decimales reales, no 1', async () => {
    const renderer = render();
    act(() => gramsInput(renderer).props.onChangeText('200'));

    // 2.474 * 2 = 4.948 → food_log persiste round(4.948, 2) = 4.95.
    const texts = allText(renderer);
    expect(texts).toContain('4.95 mcg');
    expect(texts).not.toContain('4.9 mcg');

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
    expect(mockAddEntry.mock.calls[0][0].vitamin_b12_mcg).toBe(4.95);
  });

  it('comportamiento normal (ración de 100 g, sin cruzar ningún umbral de magnitud) sigue intacto', () => {
    const renderer = render();
    const texts = allText(renderer);
    expect(texts).toContain('12.7 g'); // azúcares a 100 g, sin escalar
    expect(texts).toContain('6.2 mg'); // hierro a 100 g
    expect(texts).toContain('2.47 mcg'); // B12 a 100 g
  });
});
