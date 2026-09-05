/**
 * P0 plausibilidad — cierre del gap de foto-IA (ver auditoría: el guard de
 * ProductDetailSheet.commit() podía bloquear sin salida una comida
 * estimada por IA, que sólo permitía editar el nombre).
 *
 * Renderiza el componente real (react-test-renderer + act(), no RNTL — ver
 * precedente ya establecido en ErrorBoundary.test.tsx) y ejercita el flujo
 * de verdad: escribir en los inputs, pulsar "Añadir al diario", comprobar
 * qué llega (o no) a diaryStore.addEntry().
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import type { FoodPer100g } from '@/types';

// Misma razón que en database.test.ts / ErrorBoundary.test.tsx: la cadena
// @/theme -> themeStore -> @/db/database -> expo-sqlite no resuelve en este
// entorno de Jest. database.ts sólo toca SQLite de forma perezosa, así que
// un mock vacío es seguro — nada de este test ejercita SQLite.
jest.mock('expo-sqlite', () => ({}));

// @expo/vector-icons -> expo-font -> expo-asset, ausente en este entorno de
// test (mismo problema estructural que expo-sqlite). Ionicons es puramente
// decorativo aquí — nada de este test depende de qué icono se pinte.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));

const mockAddEntry = jest.fn();
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
  return {
    ...aiPhotoFood({}),
    source: 'openfoodfacts',
    source_ref: '111',
    ...over,
  };
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderSheet(food: FoodPer100g) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet food={food} lockedMealType="lunch" onClose={() => {}} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

/** Localiza el Button "Añadir al diario"/"Guardar cambios" por su propio prop onPress (ver nota de ErrorBoundary.test.tsx sobre por qué no comparar por tipo). */
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

function findInputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [input] = renderer.root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Input' && n.props.label === label
  );
  return input;
}

describe('ProductDetailSheet — plausibilidad nutricional de foto-IA', () => {
  it('1. foto IA + macro impossible → inicialmente no guarda, y muestra los campos editables', async () => {
    const food = aiPhotoFood({ protein_g: 40, carbs_g: 40, fat_g: 40 });
    const renderer = renderSheet(food);

    pressSaveButton(renderer);
    await act(async () => {}); // deja resolver el async de commit()

    expect(mockAddEntry).not.toHaveBeenCalled();
    // El campo concreto que falla debe ofrecerse editable con su valor real.
    const proteinInput = findInputByLabel(renderer, 'Proteína (g) por 100 g');
    expect(proteinInput).toBeDefined();
    expect(proteinInput.props.value).toBe('40');
  });

  it('2. el usuario corrige la macro → vuelve a validarse y puede guardar', async () => {
    // Sólo la proteína está desbocada (60+40+40=140) — corregir ese único
    // campo ya basta para que la suma (10+40+40=90) vuelva a ser válida, y
    // el propio campo debe desaparecer de la UI en cuanto deja de ser
    // 'impossible' (se recalcula en cada render desde effectiveFood).
    const food = aiPhotoFood({ protein_g: 60, carbs_g: 40, fat_g: 40 });
    const renderer = renderSheet(food);

    const proteinInput = findInputByLabel(renderer, 'Proteína (g) por 100 g');
    expect(proteinInput).toBeDefined();
    act(() => {
      proteinInput.props.onChangeText('10');
    });

    // Tras la corrección, el campo ya no se ofrece como editable: el
    // producto ha vuelto a ser 'valid'.
    expect(findInputByLabel(renderer, 'Proteína (g) por 100 g')).toBeUndefined();

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    const persisted = mockAddEntry.mock.calls[0][0];
    expect(persisted.protein_g).toBeCloseTo(10);
    expect(persisted.carbs_g).toBeCloseTo(40);
    expect(persisted.fat_g).toBeCloseTo(40);
  });

  it('3. foto IA + micronutriente impossible → puede guardar, y ese micro queda excluido', async () => {
    const food = aiPhotoFood({ iron_mg: 14000, iron_known: true });
    const renderer = renderSheet(food);

    // No debe ofrecerse ningún campo editable: el guard de macros no se
    // dispara por un micronutriente en solitario.
    expect(findInputByLabel(renderer, 'Proteína (g) por 100 g')).toBeUndefined();

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    const persisted = mockAddEntry.mock.calls[0][0];
    expect(persisted.iron_mg).toBeNull();
    expect(persisted.iron_known).toBe(false);
    expect(persisted.protein_g).toBeCloseTo(5); // el resto de la entry, intacto
  });

  it('4. producto normal (OFF) + macro impossible → sigue bloqueado, sin campos editables', async () => {
    const food = offFood({ protein_g: 40, carbs_g: 40, fat_g: 40 });
    const renderer = renderSheet(food);

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).not.toHaveBeenCalled();
    // Comportamiento anterior intacto: nada editable para un producto normal.
    expect(findInputByLabel(renderer, 'Proteína (g) por 100 g')).toBeUndefined();
    const dangerTexts = renderer.root.findAllByType(Text).map((n) => n.props.children);
    expect(dangerTexts).toContain('Algunos datos nutricionales parecen incorrectos.');
  });
});
