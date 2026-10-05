/**
 * Campo de gramos de `ProductDetailSheet` — en Android real, partiendo de
 * "100", tocar el campo y escribir 1, 5, 0 terminaba en "50": el primer
 * dígito se perdía porque `selectTextOnFocus` vuelve a seleccionar todo en
 * la primera pasada de `onLayout` con el campo enfocado (ver
 * `useSelectAllOnFocus`). Ese `onLayout` nativo no existe en Jest, así que
 * aquí se prueba el contrato de estado que lo evita:
 *   - el campo ya no usa `selectTextOnFocus` (la causa nativa);
 *   - al enfocar se selecciona todo UNA vez (selección controlada);
 *   - en cuanto el usuario escribe, la selección se suelta y no vuelve —
 *     cada pulsación siguiente se añade, no sustituye;
 *   - el valor final es el que se guarda, con la validación de siempre.
 * La reproducción exacta del fallo (orden de eventos nativos de Android)
 * requiere comprobación manual en el dispositivo.
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
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({ addEntry: mockAddEntry, selectedDate: '2026-09-25' });
  (useCustomFoodStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ createCustomFood: jest.fn() })
  );
});

const FOOD: FoodPer100g = {
  food_name: 'Lentejas cocidas',
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

function gramsInput(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) => n.type === TextInput && n.props.keyboardType === 'numeric' && n.props.placeholder === '100'
  )[0];
}

/**
 * Simula lo que hace Android al escribir tecla a tecla: la primera tecla
 * sustituye lo que esté seleccionado; las siguientes se insertan en la
 * posición del cursor. Usa la `selection` que el componente controla en
 * cada momento — si el componente volviera a seleccionar todo, la tecla
 * siguiente sustituiría el texto y el test lo detectaría.
 */
function typeKeys(renderer: TestRenderer.ReactTestRenderer, keys: string) {
  for (const key of keys) {
    const input = gramsInput(renderer);
    const value: string = input.props.value;
    const sel = input.props.selection as { start: number; end: number } | undefined;
    const next = sel ? value.slice(0, sel.start) + key + value.slice(sel.end) : value + key;
    act(() => {
      input.props.onChangeText(next);
    });
  }
}

function focus(renderer: TestRenderer.ReactTestRenderer) {
  act(() => {
    gramsInput(renderer).props.onFocus?.({ nativeEvent: {} });
  });
}

async function save(renderer: TestRenderer.ReactTestRenderer) {
  const [saveButton] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      n.props.title === 'Añadir al diario'
  );
  await act(async () => {
    await saveButton.props.onPress();
  });
}

describe('ProductDetailSheet — campo de gramos (selección inicial sin perder dígitos)', () => {
  it('ya no usa selectTextOnFocus (la causa nativa de la reselección en Android)', () => {
    expect(gramsInput(render()).props.selectTextOnFocus).toBeFalsy();
  });

  it('al enfocar selecciona todo el valor inicial una vez', () => {
    const r = render();
    expect(gramsInput(r).props.selection).toBeUndefined();
    focus(r);
    expect(gramsInput(r).props.selection).toEqual({ start: 0, end: 3 });
  });

  it.each([
    ['150', '150'],
    ['50', '50'],
    ['75', '75'],
    ['200', '200'],
  ])('"100" → enfocar → escribir %s → "%s" (la selección no vuelve tras el primer dígito)', async (keys, expected) => {
    const r = render();
    focus(r);
    typeKeys(r, keys);
    expect(gramsInput(r).props.value).toBe(expected);
    expect(gramsInput(r).props.selection).toBeUndefined();
    await save(r);
    expect(mockAddEntry.mock.calls[0][0].serving_size_g).toBe(Number(expected));
  });

  it('borrar todo y escribir 150 → "150"', () => {
    const r = render();
    focus(r);
    act(() => {
      gramsInput(r).props.onChangeText('');
    });
    typeKeys(r, '150');
    expect(gramsInput(r).props.value).toBe('150');
  });

  it('backspace funciona sobre el valor escrito', () => {
    const r = render();
    focus(r);
    typeKeys(r, '155');
    act(() => {
      gramsInput(r).props.onChangeText('15');
    });
    typeKeys(r, '0');
    expect(gramsInput(r).props.value).toBe('150');
  });

  it('colocar el cursor a mano suelta la selección inicial', () => {
    const r = render();
    focus(r);
    act(() => {
      gramsInput(r).props.onSelectionChange({ nativeEvent: { selection: { start: 3, end: 3 } } });
    });
    expect(gramsInput(r).props.selection).toBeUndefined();
  });

  it('el eco de la propia selección inicial no la suelta', () => {
    const r = render();
    focus(r);
    act(() => {
      gramsInput(r).props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 3 } } });
    });
    expect(gramsInput(r).props.selection).toEqual({ start: 0, end: 3 });
  });

  it('decimales con coma siguen admitiéndose como antes ("12,5" → 12.5 g)', async () => {
    const r = render();
    focus(r);
    typeKeys(r, '12,5');
    await save(r);
    expect(mockAddEntry.mock.calls[0][0].serving_size_g).toBe(12.5);
  });

  it('la validación existente se mantiene: 0 no se guarda y muestra el error de siempre', async () => {
    const r = render();
    focus(r);
    typeKeys(r, '0');
    await save(r);
    expect(mockAddEntry).not.toHaveBeenCalled();
    expect(JSON.stringify(r.toJSON())).toContain('Introduce una cantidad válida en gramos');
  });

  it('al salir del campo se suelta cualquier selección pendiente', () => {
    const r = render();
    focus(r);
    act(() => {
      gramsInput(r).props.onBlur?.({ nativeEvent: {} });
    });
    expect(gramsInput(r).props.selection).toBeUndefined();
  });
});
