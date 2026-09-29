/**
 * Auditoría del Diario — cierre de los Bugs A y C a nivel de UI:
 *   A) ProductDetailSheet.commit() en modo edición ya no hace
 *      deleteEntry(oldId) → addEntry(newId): reutiliza editEntry.id y llama
 *      a addEntry() una única vez. Este test demuestra explícitamente que
 *      la "ventana delete+insert" ha desaparecido (deleteEntry nunca se
 *      invoca durante una edición).
 *   C) un error real devuelto por addEntry() se muestra en la UI y NO se
 *      llama a onSaved() como si el guardado hubiera ido bien.
 *
 * Mismo patrón de render que ProductDetailSheet.nutritionQuality.test.tsx
 * (react-test-renderer + act(), componente real).
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import type { FoodLogEntry } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));

const mockAddEntry = jest.fn();
// Sentinel: si algún día se reintrodujera una llamada a deleteEntry durante
// la edición, este test lo detectaría — aunque el componente ya no la
// destructura del store, el mock la expone por si acaso.
const mockDeleteEntry = jest.fn();

beforeEach(() => {
  mockAddEntry.mockReset();
  mockAddEntry.mockResolvedValue({ error: null });
  mockDeleteEntry.mockReset();
  mockDeleteEntry.mockResolvedValue({ error: null });

  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' } })
  );
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    addEntry: mockAddEntry,
    deleteEntry: mockDeleteEntry,
    selectedDate: '2026-09-07',
  });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

const EDIT_ENTRY: FoodLogEntry = {
  id: 'original-entry-id',
  user_id: 'user-1',
  date: '2026-09-05',
  meal_type: 'lunch',
  food_name: 'Lentejas',
  barcode: null,
  brand: null,
  serving_size_g: 150,
  calories: 174,
  protein_g: 13.5,
  carbs_g: 30,
  fat_g: 0.6,
  fiber_g: 11.9,
  sugar_g: 1,
  saturated_fat_g: 0.1,
  sodium_mg: 5,
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
  source: 'openfoodfacts',
  source_ref: '111',
  is_vegan: true,
  image_url: null,
  created_at: '2026-09-05T12:00:00.000Z',
};

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderEditSheet(onSaved: () => void) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet editEntry={EDIT_ENTRY} onClose={() => {}} onSaved={onSaved} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

/** Mismo criterio que en ProductDetailSheet.nutritionQuality.test.tsx: se
 *  busca por props distintivos, no por identidad de tipo. */
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

describe('ProductDetailSheet — edición atómica (auditoría del Diario, Bugs A y C)', () => {
  it('1/2. editar reutiliza el mismo id y llama a addEntry UNA sola vez — nunca a deleteEntry (desaparece la ventana delete+insert)', async () => {
    const mockOnSaved = jest.fn();
    const renderer = renderEditSheet(mockOnSaved);

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockDeleteEntry).not.toHaveBeenCalled(); // la ventana delete+insert ya no existe
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    const persisted = mockAddEntry.mock.calls[0][0];
    expect(persisted.id).toBe(EDIT_ENTRY.id); // mismo id, no uno nuevo
    expect(persisted.date).toBe(EDIT_ENTRY.date); // la fecha original se conserva
    expect(mockOnSaved).toHaveBeenCalledTimes(1);
  });

  it('3. fallo remoto real → el error se muestra en la UI y NO se llama a onSaved (no se da por bueno un guardado que no ocurrió)', async () => {
    mockAddEntry.mockResolvedValue({ error: 'permission denied' });
    const mockOnSaved = jest.fn();
    const renderer = renderEditSheet(mockOnSaved);

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockOnSaved).not.toHaveBeenCalled();
    const texts = renderer.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain('permission denied');
  });
});
