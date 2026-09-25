/**
 * Auditoría de fricción del registro recurrente — tocar un alimento en
 * "Recientes" debe pasar `last_serving_g` como `initialGrams` a
 * `ProductDetailSheet`, para no obligar a reescribir la ración de siempre.
 * El resto de caminos de apertura (frescos, custom, resultados de búsqueda,
 * código de barras) no deben verse afectados: siguen sin `initialGrams`
 * (`ProductDetailSheet` cae a su default de 100 g, ver
 * `ProductDetailSheet.initialGrams.test.tsx`).
 *
 * Mismo patrón de mock de `ProductDetailSheet` que
 * `SearchScreen.activation.test.tsx`: se inspeccionan las props con las que
 * se invoca, no su render interno.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { SearchScreen } from '@/screens/SearchScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import type { RecentFood } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ navigate: jest.fn(), setParams: jest.fn() }),
  useRoute: () => ({ params: undefined }),
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

const RECENT: RecentFood = {
  food_name: 'Tofu a la plancha',
  barcode: null,
  brand: null,
  image_url: null,
  calories_per_100g: 145,
  protein_per_100g: 15,
  carbs_per_100g: 2,
  fat_per_100g: 9,
  fiber_per_100g: 1,
  sugar_per_100g: 0.5,
  saturated_fat_per_100g: 1,
  sodium_per_100g: 10,
  vitamin_b12_mcg_per_100g: null,
  iron_mg_per_100g: null,
  zinc_mg_per_100g: null,
  calcium_mg_per_100g: null,
  omega3_g_per_100g: null,
  vitamin_d_mcg_per_100g: null,
  vitamin_b12_known: false,
  iron_known: false,
  zinc_known: false,
  calcium_known: false,
  omega3_known: false,
  vitamin_d_known: false,
  is_vegan: true,
  last_serving_g: 180,
  use_count: 6,
};

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
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'user-1' },
      profile: { calorie_target: 2000, protein_target_g: 100, carbs_target_g: 250, fat_target_g: 70 },
    })
  );
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    recentFoods: [RECENT],
    fetchRecentFoods: jest.fn().mockResolvedValue(undefined),
  });
  (useCustomFoodStore as unknown as jest.Mock).mockReturnValue({
    fetchCustomFoods: jest.fn().mockResolvedValue(undefined),
    searchCustomFoods: jest.fn(() => []),
  });
});

describe('SearchScreen — initialGrams al tocar un Reciente', () => {
  it('tocar un alimento de Recientes pasa su last_serving_g como initialGrams', () => {
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Tofu a la plancha');

    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { initialGrams?: number };
    expect(sheetProps.initialGrams).toBe(180);
  });

  it('tocar un fresco (otro camino de apertura) NO pasa initialGrams', () => {
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Brócoli');

    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { initialGrams?: number };
    expect(sheetProps.initialGrams).toBeUndefined();
  });

  it('abrir un fresco DESPUÉS de un Reciente no arrastra el initialGrams anterior', () => {
    const renderer = renderSearchScreen();

    pressNodeContaining(renderer, 'Tofu a la plancha');
    expect((mockProductDetailSheet.mock.calls.at(-1)?.[0] as { initialGrams?: number }).initialGrams).toBe(180);

    act(() => {
      (mockProductDetailSheet.mock.calls.at(-1)?.[0] as { onClose: () => void }).onClose();
    });
    pressNodeContaining(renderer, 'Brócoli');

    const sheetProps = mockProductDetailSheet.mock.calls.at(-1)?.[0] as { initialGrams?: number };
    expect(sheetProps.initialGrams).toBeUndefined();
  });
});
