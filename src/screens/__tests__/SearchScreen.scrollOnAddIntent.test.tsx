/**
 * Buscar es una pestaña: tras la primera visita sigue montada y su
 * ScrollView conservaba el desplazamiento de la visita anterior — al tocar
 * "＋" en el Diario, Buscar podía abrirse a media lista. Ahora vuelve arriba
 * (buscador visible) al recibir el foco CON intención de añadir
 * (`mealType`/`nutrient`), y sólo entonces: ni en cada re-render ni al
 * entrar tocando la pestaña.
 *
 * El mock de `useFocusEffect` reproduce el ciclo real: ejecuta el efecto al
 * montar (pantalla enfocada), cuando su callback cambia estando enfocada y
 * en cada re-foco (`refocus()`); un re-render con las mismas dependencias no
 * lo vuelve a ejecutar. Un blur (`blur()`) ejecuta el cleanup.
 */
import React from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { SearchScreen } from '@/screens/SearchScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let mockRouteParams: { mealType?: string; nutrient?: string; fromActivation?: boolean } | undefined;
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockFocusListeners = new Set<(focused: boolean) => void>();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    const [state, setState] = ReactActual.useState({ focused: true, gen: 0 });
    ReactActual.useEffect(() => {
      const l = (focused: boolean) => setState((s: { gen: number }) => ({ focused, gen: s.gen + 1 }));
      mockFocusListeners.add(l);
      return () => {
        mockFocusListeners.delete(l);
      };
    }, []);
    ReactActual.useEffect(() => (state.focused ? cb() : undefined), [cb, state]);
  },
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({
  useCustomFoodStore: jest.fn(),
  customFoodToPer100g: jest.fn(),
}));
jest.mock('@/lib/freshProduce', () => ({
  searchFreshProduce: jest.fn(() => []),
  freshItemToProduct: jest.fn((item: unknown) => item),
}));
jest.mock('@/lib/openfoodfacts', () => ({
  canSuggestVeganAlternative: jest.fn(() => false),
  findVeganAlternatives: jest.fn().mockResolvedValue([]),
  getProductByBarcode: jest.fn().mockResolvedValue(null),
  getVeganConfidence: jest.fn(() => 'unknown'),
  productToFoodPer100g: jest.fn((p: unknown) => p),
  searchProducts: jest.fn().mockResolvedValue({ products: [] }),
  normalizeProduct: jest.fn((p: unknown) => p),
}));
jest.mock('@/components/ProductDetailSheet', () => ({ ProductDetailSheet: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const tree = () => (
  <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
    <SearchScreen />
  </SafeAreaProvider>
);

let scrollTo: jest.Mock;

/**
 * Monta Buscar y espía `scrollTo` en la instancia real del ScrollView (la
 * misma a la que apunta el ref de la pantalla). El efecto de foco del
 * montaje ya ha corrido al terminar `create`, así que se pasa `mountParams`
 * para el estado inicial y se observa lo que ocurre DESPUÉS.
 */
function mount() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  const instance = renderer.root.findByType(ScrollView).instance as { scrollTo: (...a: unknown[]) => void };
  scrollTo = jest.fn();
  instance.scrollTo = scrollTo;
  return renderer;
}

function blur() {
  act(() => mockFocusListeners.forEach((l) => l(false)));
}

function focus(renderer: TestRenderer.ReactTestRenderer, params: typeof mockRouteParams) {
  mockRouteParams = params;
  act(() => {
    renderer.update(tree());
    mockFocusListeners.forEach((l) => l(true));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusListeners.clear();
  mockRouteParams = undefined;
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, profile: null })
  );
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    recentFoods: [],
    fetchRecentFoods: jest.fn().mockResolvedValue(undefined),
  });
  (useCustomFoodStore as unknown as jest.Mock).mockReturnValue({
    fetchCustomFoods: jest.fn().mockResolvedValue(undefined),
    searchCustomFoods: jest.fn(() => []),
  });
});

describe('SearchScreen — vuelve arriba al llegar para añadir un alimento', () => {
  it('"＋" del Diario (mealType): al recibir el foco vuelve arriba, sin animación', () => {
    const r = mount();
    blur();
    focus(r, { mealType: 'lunch' });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('"Ver alimentos" del Resumen (nutrient): también vuelve arriba', () => {
    const r = mount();
    blur();
    focus(r, { nutrient: 'iron_mg' });
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('cada nueva llegada desde "＋" vuelve arriba otra vez', () => {
    const r = mount();
    blur();
    focus(r, { mealType: 'lunch' });
    blur();
    mockRouteParams = undefined; // el cleanup de Buscar limpia los params al salir
    focus(r, { mealType: 'dinner' });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('no hace scroll en re-renders estando ya en Buscar', () => {
    const r = mount();
    blur();
    focus(r, { mealType: 'lunch' });
    scrollTo.mockClear();
    act(() => {
      r.update(tree());
      r.update(tree());
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('entrar tocando la pestaña (sin intención de añadir) conserva el comportamiento de siempre: no fuerza scroll', () => {
    const r = mount();
    blur();
    focus(r, undefined);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('fromActivation no fuerza scroll (primera visita: ya está arriba; ese param no se limpia al salir)', () => {
    const r = mount();
    blur();
    focus(r, { fromActivation: true });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('no rompe la navegación existente: al salir sigue limpiando mealType y nutrient', () => {
    const r = mount();
    blur();
    focus(r, { mealType: 'lunch' });
    mockSetParams.mockClear();
    blur();
    expect(mockSetParams).toHaveBeenCalledWith({ mealType: undefined, nutrient: undefined });
  });
});
