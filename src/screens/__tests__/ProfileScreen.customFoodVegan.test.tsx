/**
 * Auditoría de alimentos personalizados — `is_vegan` se guardaba SIEMPRE
 * como `true` al crear un alimento personalizado, y ni siquiera se
 * transmitía al editar uno existente: no había ningún punto de la app
 * (tampoco `ProductDetailSheet`, que sólo ofrece corrección manual de
 * veganismo para `source: 'ai_photo'`) desde el que corregir el veganismo de
 * un alimento personalizado no vegano (p. ej. "Caldo de pollo casero",
 * creado sólo para llevar la cuenta de sus calorías). Ahora es un campo más
 * del formulario, tan editable como las macros.
 *
 * También cubre la falta de protección contra doble tap en `save()`
 * (a diferencia de `ProductDetailSheet.commit()`/`copyFromYesterday()`, que
 * sí deshabilitan su botón mientras la operación está en curso): sin ella,
 * un doble toque podía crear el mismo alimento dos veces.
 *
 * `CustomFoodModal` se exporta sólo para este test (mismo criterio que
 * `SupplementsModal` en `ProfileScreen.supplementPaywall.test.tsx`).
 */
import React from 'react';
import { Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { CustomFoodModal } from '@/screens/ProfileScreen';
import { useAuthStore } from '@/stores/authStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import type { CustomFood } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({
  useSupplementStore: jest.fn(() => ({ supplements: [] })),
  SUPPLEMENT_PRESETS: [],
}));
jest.mock('@/hooks/usePro', () => ({
  usePro: jest.fn(() => ({ isPro: false })),
  FREE_SUPPLEMENT_LIMIT: 3,
}));
jest.mock('@/lib/supabase', () => ({ WEB_BASE_URL: 'https://vegantrack.app' }));
jest.mock('@/notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 20,
  getReminderHour: jest.fn().mockResolvedValue(20),
  scheduleDailyReminder: jest.fn(),
  disableDailyReminder: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const EXISTING_FOOD: CustomFood = {
  id: 'food-1',
  user_id: 'user-1',
  name: 'Caldo de pollo casero',
  brand: null,
  image_url: null,
  is_vegan: false,
  calories_per_100g: 20,
  protein_per_100g: 2,
  carbs_per_100g: 1,
  fat_per_100g: 1,
  fiber_per_100g: 0,
  sugar_per_100g: 0,
  saturated_fat_per_100g: 0,
  sodium_mg_per_100g: 300,
  vitamin_b12_mcg_per_100g: null,
  iron_mg_per_100g: null,
  zinc_mg_per_100g: null,
  calcium_mg_per_100g: null,
  vitamin_d_mcg_per_100g: null,
  omega3_g_per_100g: null,
  created_at: '',
  updated_at: '',
} as CustomFood;

function renderModal(store: ReturnType<typeof makeStore>) {
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
  (useCustomFoodStore as unknown as jest.Mock).mockReturnValue(store);
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <CustomFoodModal onClose={jest.fn()} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function makeStore(overrides: Partial<ReturnType<typeof baseStore>> = {}) {
  return { ...baseStore(), ...overrides };
}

function baseStore() {
  return {
    customFoods: [] as CustomFood[],
    loading: false,
    fetchCustomFoods: jest.fn().mockResolvedValue(undefined),
    searchCustomFoods: jest.fn(() => []),
    createCustomFood: jest.fn().mockResolvedValue({ error: null }),
    updateCustomFood: jest.fn().mockResolvedValue({ error: null }),
    deleteCustomFood: jest.fn().mockResolvedValue({ error: null }),
  };
}

/** Pulsa el `Pressable` de texto plano cuya etiqueta es exactamente `label`
 * (p. ej. "Crear alimento personalizado") — sube desde el nodo de texto
 * hasta el `Pressable` más cercano. No sirve para los botones de guardar
 * (ver `findButtonByTitle`): esos cambian su contenido a un
 * `ActivityIndicator` en cuanto `saving` es `true`, así que su texto puede
 * desaparecer del árbol justo cuando más interesa pulsarlos dos veces. */
function pressByText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [textNode] = renderer.root.findAll(
    (n) => typeof n.props?.children === 'string' && n.props.children === label
  );
  let node = textNode;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

/** Localiza el propio componente `Button` (no su `Pressable`/`Text` interno)
 * por su `title` — su `onPress` sigue siendo `save` esté o no en `loading`,
 * a diferencia de buscar por el texto visible, que desaparece en `loading`. */
function findButtonByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  const [button] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      n.props.title === title
  );
  return button;
}

/** Pulsa el icono de editar (lápiz) de la primera fila de la lista — el
 * nombre del alimento en sí no es pulsable, sólo los iconos de editar/
 * eliminar a su lado. */
function pressEditFirstFood(renderer: TestRenderer.ReactTestRenderer) {
  const [pencilIcon] = renderer.root.findAll(
    (n) => n.type === Ionicons && n.props.name === 'pencil-outline'
  );
  let node = pencilIcon;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CustomFoodModal — is_vegan ya no queda fijo en `true`', () => {
  it('crear un alimento nuevo: el interruptor "¿Es vegano?" empieza en Sí, pero se puede apagar antes de guardar', async () => {
    const store = makeStore();
    const renderer = renderModal(store);

    pressByText(renderer, 'Crear alimento personalizado');
    const [veganSwitch] = renderer.root.findAllByType(Switch);
    expect(veganSwitch.props.value).toBe(true); // valor por defecto razonable

    act(() => veganSwitch.props.onValueChange(false));

    const [nameInput] = renderer.root.findAllByProps({ label: 'Nombre' });
    act(() => nameInput.props.onChangeText('Caldo de pollo casero'));

    await act(async () => {
      findButtonByTitle(renderer, 'Crear alimento').props.onPress();
    });

    expect(store.createCustomFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ is_vegan: false, name: 'Caldo de pollo casero' })
    );
  });

  it('editar un alimento existente NO vegano: precarga el interruptor en No, y se puede corregir a vegano', async () => {
    const store = makeStore({ customFoods: [EXISTING_FOOD] });
    const renderer = renderModal(store);

    pressEditFirstFood(renderer);
    const [veganSwitch] = renderer.root.findAllByType(Switch);
    expect(veganSwitch.props.value).toBe(false); // precarga el valor real, no siempre true

    act(() => veganSwitch.props.onValueChange(true));
    await act(async () => {
      findButtonByTitle(renderer, 'Guardar cambios').props.onPress();
    });

    expect(store.updateCustomFood).toHaveBeenCalledWith(
      EXISTING_FOOD.id,
      expect.objectContaining({ is_vegan: true })
    );
  });

  it('un doble tap en "Crear alimento" no crea el alimento dos veces', async () => {
    let resolveCreate!: (v: { error: null }) => void;
    const store = makeStore({
      createCustomFood: jest.fn(() => new Promise((resolve) => { resolveCreate = resolve; })),
    });
    const renderer = renderModal(store);

    pressByText(renderer, 'Crear alimento personalizado');
    const [nameInput] = renderer.root.findAllByProps({ label: 'Nombre' });
    act(() => nameInput.props.onChangeText('Tofu'));

    // Dos toques seguidos, antes de que el primero resuelva — se busca el
    // botón de nuevo cada vez, como haría un segundo toque real.
    act(() => {
      findButtonByTitle(renderer, 'Crear alimento').props.onPress();
    });
    act(() => {
      findButtonByTitle(renderer, 'Crear alimento').props.onPress();
    });
    await act(async () => {
      resolveCreate({ error: null });
      await Promise.resolve();
    });

    expect(store.createCustomFood).toHaveBeenCalledTimes(1);
  });
});
