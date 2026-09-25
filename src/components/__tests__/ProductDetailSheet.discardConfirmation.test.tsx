/**
 * Auditoría del flujo de foto-IA — cerrar un resultado de IA todavía sin
 * guardar tira el análisis entero: para Free (1 análisis a la semana) eso
 * significa repetir la única foto de la semana, y a cualquiera le cuesta una
 * llamada a Gemini ya gastada. Los 4 gestos de cierre del `BottomSheet` (tap
 * fuera, tap en el handle, deslizar hacia abajo, botón "atrás" del SO) lo
 * perdían sin ningún aviso.
 *
 * Este archivo prueba sólo la confirmación nueva (`handleRequestClose`,
 * interceptando el `onClose` que `ProductDetailSheet` le pasa al
 * `BottomSheet` real, no el `onClose` que él mismo recibe de su padre — ver
 * el comentario en el propio componente). La instrumentación
 * (`photo_result_discarded` etc.) ya está cubierta en
 * `ProductDetailSheet.aiPhotoInstrumentation.test.tsx` y no se toca aquí:
 * esos tests llaman al `onClose` del padre directamente, sin pasar por el
 * gesto real del `BottomSheet`, así que no ejercitan esta confirmación —
 * confirmado también por el test "no interfiere" de más abajo.
 */
import React from 'react';
import { Alert, Modal } from 'react-native';
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
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

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
    selectedDate: '2026-09-25',
  });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

function aiPhotoFood(over: Partial<FoodPer100g> = {}): FoodPer100g {
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

function searchFood(over: Partial<FoodPer100g> = {}): FoodPer100g {
  return {
    ...aiPhotoFood(),
    brand: null,
    source: 'openfoodfacts',
    ...over,
  };
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(props: Partial<React.ComponentProps<typeof ProductDetailSheet>>, onClose = jest.fn()) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet onClose={onClose} {...props} />
      </SafeAreaProvider>
    );
  });
  return { renderer, onClose };
}

/** El botón "atrás" del sistema — uno de los 4 gestos reales de cierre del
 * `BottomSheet`, todos cableados al mismo `onClose` que le pasa
 * `ProductDetailSheet` (ahora `handleRequestClose`). */
function pressSystemBack(renderer: TestRenderer.ReactTestRenderer) {
  act(() => {
    renderer.root.findByType(Modal).props.onRequestClose();
  });
}

function pressSaveButton(renderer: TestRenderer.ReactTestRenderer) {
  const [saveButton] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      typeof n.props.onPress === 'function' &&
      n.props.title === 'Añadir al diario'
  );
  act(() => {
    void saveButton.props.onPress();
  });
}

describe('ProductDetailSheet — confirmación al cerrar un análisis de foto-IA sin guardar', () => {
  it('foto-IA sin guardar: el gesto de cierre pregunta antes de descartar, sin cerrar todavía', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { renderer, onClose } = render({ food: aiPhotoFood() });

    pressSystemBack(renderer);

    expect(alertSpy).toHaveBeenCalledWith(
      '¿Descartar este análisis?',
      expect.stringContaining('perderás'),
      expect.any(Array)
    );
    expect(onClose).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('"Descartar" en la confirmación sí cierra la ficha', () => {
    let capturedButtons: { text: string; onPress?: () => void }[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      capturedButtons = (buttons ?? []) as typeof capturedButtons;
    });
    const { renderer, onClose } = render({ food: aiPhotoFood() });

    pressSystemBack(renderer);
    const discardButton = capturedButtons.find((b) => b.text === 'Descartar');
    expect(discardButton).toBeDefined();
    act(() => discardButton!.onPress!());

    expect(onClose).toHaveBeenCalledTimes(1);
    (Alert.alert as jest.Mock).mockRestore();
  });

  it('"Seguir aquí" NO cierra la ficha — el análisis sigue disponible', () => {
    let capturedButtons: { text: string; onPress?: () => void }[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      capturedButtons = (buttons ?? []) as typeof capturedButtons;
    });
    const { renderer, onClose } = render({ food: aiPhotoFood() });

    pressSystemBack(renderer);
    const keepButton = capturedButtons.find((b) => b.text === 'Seguir aquí');
    expect(keepButton).toBeDefined();
    if (keepButton!.onPress) act(() => keepButton!.onPress!());

    expect(onClose).not.toHaveBeenCalled();
    (Alert.alert as jest.Mock).mockRestore();
  });

  it('tras guardar con éxito, un cierre posterior no muestra confirmación (ya no hay nada que perder)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { renderer, onClose } = render({ food: aiPhotoFood() });

    pressSaveButton(renderer);
    await act(async () => {});
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    // El propio guardado ya llama a onClose() directamente (sin pasar por
    // el gesto del BottomSheet) — se resetea aquí para aislar la aserción
    // de lo que pasaría si además se disparase un gesto de cierre después.
    onClose.mockClear();

    pressSystemBack(renderer);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('un alimento normal (búsqueda, no foto-IA) se cierra sin ninguna confirmación', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { renderer, onClose } = render({ food: searchFood() });

    pressSystemBack(renderer);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('editar una entrada existente se cierra sin ninguna confirmación', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { renderer, onClose } = render({
      editEntry: {
        ...aiPhotoFood(),
        id: 'entry-1',
        user_id: 'user-1',
        date: '2026-09-25',
        meal_type: 'lunch',
        serving_size_g: 100,
        created_at: '2026-09-25T12:00:00Z',
      } as any,
    });

    pressSystemBack(renderer);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});
