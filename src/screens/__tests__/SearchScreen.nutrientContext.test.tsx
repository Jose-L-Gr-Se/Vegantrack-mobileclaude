/**
 * Nutrition Insight accionable — cuando se llega a Buscar desde el botón
 * "Ver alimentos" de una prioridad del Dashboard (`route.params.nutrient`),
 * la pantalla muestra un aviso contextual con las mismas fuentes de
 * `MICRO_FOOD_SOURCES` que ya se ven bajo la barra de ese micro — nunca una
 * búsqueda automática ni resultados filtrados, el usuario sigue escribiendo
 * y decidiendo qué añadir. Sin ese contexto, la pantalla se comporta
 * exactamente igual que siempre (regresión del flujo normal de búsqueda).
 *
 * Mismo arnés que `SearchScreen.activation.test.tsx`.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { SearchScreen } from '@/screens/SearchScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import { MICRO_FOOD_SOURCES } from '@/utils/microRecommendations';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let mockRouteParams: { mealType?: string; barcode?: string; fromActivation?: boolean; nutrient?: string } | undefined;
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
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

describe('SearchScreen — contexto de nutriente (Nutrition Insight accionable)', () => {
  it('al llegar con nutrient="iron_mg" muestra el aviso con la misma fuente alimentaria que el Dashboard', () => {
    mockRouteParams = { nutrient: 'iron_mg' };
    const renderer = renderSearchScreen();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('hierro');
    expect(text).toContain(MICRO_FOOD_SOURCES.iron_mg);
  });

  it('sin nutrient en los params, no muestra ningún aviso de contexto (flujo normal sin cambios)', () => {
    const renderer = renderSearchScreen();
    const text = JSON.stringify(renderer.toJSON());

    for (const source of Object.values(MICRO_FOOD_SOURCES)) {
      expect(text).not.toContain(source);
    }
  });

  it('sin contexto de nutriente, buscar y añadir un alimento sigue funcionando exactamente igual (regresión)', () => {
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Brócoli');
    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { onAdded: (msg: string) => void };
    act(() => sheetProps.onAdded('Añadido'));

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Diary' });
  });

  it('con contexto de nutriente, buscar y añadir un alimento también funciona igual (el aviso no interfiere con el flujo)', () => {
    mockRouteParams = { nutrient: 'iron_mg' };
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Brócoli');
    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { onAdded: (msg: string) => void };
    act(() => sheetProps.onAdded('Añadido'));

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Diary' });
  });
});
