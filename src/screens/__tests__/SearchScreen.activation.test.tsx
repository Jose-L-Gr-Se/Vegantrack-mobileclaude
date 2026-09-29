/**
 * Bloque 1 de activación (Product Audit v2) — "onboarding_completed →
 * first_food_logged". Al añadir un alimento desde Buscar habiendo llegado
 * con `fromActivation: true` (desde la nueva pantalla de activación
 * post-onboarding), el destino tras guardar pasa a ser el Dashboard en vez
 * del Diario — el resto del flujo de búsqueda/añadido no cambia.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { SearchScreen } from '@/screens/SearchScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let mockRouteParams: { mealType?: string; barcode?: string; fromActivation?: boolean } | undefined;
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ navigate: mockNavigate, setParams: jest.fn() }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/customFoodStore', () => ({
  useCustomFoodStore: jest.fn(),
  customFoodToPer100g: jest.fn(),
}));

// Un único alimento "fresco" sincrónico (sin buscar ni debounce) para llegar
// a `selected` sin depender de la búsqueda asíncrona contra OpenFoodFacts —
// no es el objeto de esta prueba, sólo la vía más simple para abrir la ficha.
jest.mock('@/lib/freshProduce', () => ({
  searchFreshProduce: jest.fn(() => [{ id: 'fresh-1', emoji: '🥦', name: 'Brócoli', calories_per_100g: 34 }]),
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

const mockProductDetailSheet = jest.fn((_props: unknown) => null);
jest.mock('@/components/ProductDetailSheet', () => ({
  ProductDetailSheet: (props: unknown) => mockProductDetailSheet(props),
}));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderSearchScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <SearchScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

/** Localiza un nodo cuyo texto (posiblemente repartido en varios children,
 * p. ej. `{emoji} {name}`) contiene `substring`, y sube hasta el `Pressable`
 * que lo envuelve. */
function pressNodeContaining(renderer: TestRenderer.ReactTestRenderer, substring: string) {
  const matches = renderer.root.findAll((n) => {
    const c = n.props.children;
    if (typeof c === 'string') return c.includes(substring);
    if (Array.isArray(c)) return c.filter((x) => typeof x === 'string').join('').includes(substring);
    return false;
  });
  let node = matches[0];
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;

  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'user-1' },
      profile: { calorie_target: 2000, protein_target_g: 100, carbs_target_g: 250, fat_target_g: 70 },
    })
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

describe('SearchScreen — activación post-onboarding (fromActivation)', () => {
  it('con fromActivation, al añadir el alimento navega al Dashboard en vez de al Diario', () => {
    mockRouteParams = { fromActivation: true };
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Brócoli');
    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { onAdded: (msg: string) => void };
    act(() => sheetProps.onAdded('Añadido'));

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Dashboard' });
  });

  it('sin fromActivation, al añadir el alimento sigue yendo al Diario (comportamiento de siempre)', () => {
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Brócoli');
    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { onAdded: (msg: string) => void };
    act(() => sheetProps.onAdded('Añadido'));

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Diary' });
  });
});
