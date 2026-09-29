/**
 * Auditoría IA→resultado→guardar (ronda de observabilidad y fricción):
 *
 * - `photo_result_viewed` / `photo_result_discarded` / `photo_entry_save_failed`
 *   son nuevos; `photo_entry_saved` NO se toca aquí (sigue viviendo en
 *   `useMealPhoto`/`DiaryScreen`, fuera de este componente) — no se prueba
 *   en este archivo.
 * - Preselección de `meal_type` por hora en el resultado de foto-IA
 *   (`mealTypeForHour`, ver `foodEntry.mealTypeForHour.test.ts` para los
 *   límites de la función pura) — aquí sólo se prueba la integración: que
 *   el resultado llega ya con una comida elegida y que se puede cambiar.
 *
 * Mismo patrón de render que el resto de tests de este componente
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
import { track } from '@/lib/analytics';
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
    selectedDate: '2026-09-05',
  });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
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

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** Sin `lockedMealType`: es exactamente como `DiaryScreen` monta la ficha
 * tras un análisis de foto-IA — el `meal` interno debe autoseleccionarse. */
function renderAiResult(props: Partial<React.ComponentProps<typeof ProductDetailSheet>> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProductDetailSheet food={aiPhotoFood()} onClose={() => {}} {...props} />
      </SafeAreaProvider>
    );
  });
  return renderer;
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

function findPressableWithText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root
    .findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Pressable')
    .find((p) => p.findAllByType(Text).some((t) => t.props.children === text));
}

describe('ProductDetailSheet — instrumentación del resultado de foto-IA', () => {
  it('photo_result_viewed se mide una sola vez al mostrar el resultado', () => {
    const renderer = renderAiResult();

    expect(track).toHaveBeenCalledWith('photo_result_viewed');
    expect((track as jest.Mock).mock.calls.filter((c) => c[0] === 'photo_result_viewed')).toHaveLength(1);

    act(() => renderer.unmount());
  });

  it('cerrar sin guardar mide photo_result_discarded, sin datos de comida en el payload', () => {
    const renderer = renderAiResult();

    act(() => renderer.unmount());

    expect(track).toHaveBeenCalledWith('photo_result_discarded');
    const call = (track as jest.Mock).mock.calls.find((c) => c[0] === 'photo_result_discarded')!;
    // Sin segundo argumento (sin props) — no hay nombre/macros/imagen/barcode que filtrar.
    expect(call).toHaveLength(1);
  });

  it('múltiples gestos de cierre (tap fuera + swipe + atrás, todos llaman a onClose) sólo producen un photo_result_discarded', () => {
    const onClose = jest.fn();
    const renderer = renderAiResult({ onClose });

    // Los 4 gestos del BottomSheet real llaman todos al mismo prop `onClose`
    // — simular varias llamadas seguidas (solapamiento de gestos) antes de
    // que el padre reaccione y desmonte, para probar que el conteo no
    // depende de cuántas veces se invoque `onClose`, sólo del desmontaje.
    act(() => {
      onClose();
      onClose();
      onClose();
    });

    act(() => renderer.unmount());

    expect((track as jest.Mock).mock.calls.filter((c) => c[0] === 'photo_result_discarded')).toHaveLength(1);
  });

  it('guardar correctamente NO dispara photo_result_discarded', async () => {
    const renderer = renderAiResult();

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());

    expect((track as jest.Mock).mock.calls.some((c) => c[0] === 'photo_result_discarded')).toBe(false);
  });

  it('guardado fallido (error de addEntry) mide photo_entry_save_failed', async () => {
    mockAddEntry.mockResolvedValue({ error: 'Fallo de servidor' });
    const renderer = renderAiResult();

    pressSaveButton(renderer);
    await act(async () => {});

    expect(track).toHaveBeenCalledWith('photo_entry_save_failed', { reason: 'server_error' });
    // Un intento fallido no es por sí solo un "guardado": si además se
    // cierra sin reintentar con éxito, el resultado también se descarta.
    act(() => renderer.unmount());
    expect(track).toHaveBeenCalledWith('photo_result_discarded');
  });

  it('guardado bloqueado por gramos inválidos también mide photo_entry_save_failed', async () => {
    const renderer = renderAiResult();
    const gramsInput = renderer.root.findAll(
      (n) => n.props.placeholder === '100' && typeof n.props.onChangeText === 'function'
    )[0];
    act(() => gramsInput.props.onChangeText('0'));

    pressSaveButton(renderer);
    await act(async () => {});

    expect(track).toHaveBeenCalledWith('photo_entry_save_failed', { reason: 'invalid_grams' });
    expect(mockAddEntry).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('el resultado de foto-IA llega con una comida ya preseleccionada (sin tocar el selector, guarda directamente)', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(8); // 08:00 → breakfast
    const renderer = renderAiResult();

    // Sin tocar el selector de comida: si no hubiera preselección, esto
    // bloquearía el guardado con "Elige a qué comida añadirlo".
    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].meal_type).toBe('breakfast');
    expect(track).not.toHaveBeenCalledWith('photo_entry_save_failed', expect.anything());
    act(() => renderer.unmount());
  });

  it('el cambio manual de comida sigue funcionando y prevalece sobre la preselección', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(8); // preselección: breakfast
    const renderer = renderAiResult();

    const lunchChip = findPressableWithText(renderer, 'Comida'); // MEAL_LABELS.lunch
    expect(lunchChip).toBeDefined();
    act(() => lunchChip!.props.onPress());

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].meal_type).toBe('lunch');
    act(() => renderer.unmount());
  });

  it('otros flujos (lockedMealType explícito) no cambian: sigue ganando sobre la preselección por hora', async () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(8); // preselección sería breakfast
    const renderer = renderAiResult({ lockedMealType: 'dinner' });

    pressSaveButton(renderer);
    await act(async () => {});

    expect(mockAddEntry.mock.calls[0][0].meal_type).toBe('dinner');
    act(() => renderer.unmount());
  });
});
