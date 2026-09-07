/**
 * Auditoría de instrumentación del funnel — cierre del dead-end de
 * RecipesScreen: alcanzar el límite free ya no deja al usuario en un
 * `Alert` sin salida. Ahora ofrece "Ver Pro" (abre `ProModal`) y mide
 * `paywall_viewed` con `source: 'recipes_limit'`.
 */
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { RecipesScreen } from '@/screens/RecipesScreen';
import { useAuthStore } from '@/stores/authStore';
import { useRecipeStore } from '@/stores/recipeStore';
import { usePro } from '@/hooks/usePro';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
// `AddFoodModal.tsx` (importado por RecipesScreen sólo por `MEAL_LABELS`)
// importa `diaryStore.ts` de verdad, que arrastra `@sentry/react-native` —
// una dependencia con ESM que este proyecto no transforma en tests. Mismo
// mock que usan las pantallas del Diario para cortar esa cadena.
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/recipeStore', () => ({
  useRecipeStore: jest.fn(),
  computeRecipeNutrients: () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, total_g: 0 }),
}));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn(), FREE_RECIPE_LIMIT: 3 }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const mockProModal = jest.fn((_props: unknown) => null);
jest.mock('@/components/ProModal', () => ({ ProModal: (props: unknown) => mockProModal(props) }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderRecipesScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <RecipesScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function findButtonByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  const [button] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      typeof n.props.onPress === 'function' &&
      n.props.title === title
  );
  return button;
}

function findInputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [input] = renderer.root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Input' && n.props.label === label
  );
  return input;
}

/** El botón "+" que abre el modal de creación: primer Pressable con onPress
 * del árbol (aparece antes que "Cerrar" en el JSX de la cabecera). El modal
 * de creación no renderiza su contenido hasta que `showCreate` es true. */
function openCreateModal(renderer: TestRenderer.ReactTestRenderer) {
  const [plusButton] = renderer.root.findAll((n) => typeof n.props.onPress === 'function');
  act(() => plusButton.props.onPress());
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
  (useRecipeStore as unknown as jest.Mock).mockReturnValue({
    recipes: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }], // ya en el límite free (3)
    fetchRecipes: jest.fn().mockResolvedValue(undefined),
    createRecipe: jest.fn(),
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('RecipesScreen — cierre del dead-end de paywall', () => {
  it('alcanzar el límite free mide paywall_viewed(recipes_limit) y el Alert ofrece "Ver Pro" que abre ProModal', () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = renderRecipesScreen();
    openCreateModal(renderer);

    act(() => findInputByLabel(renderer, 'Nombre').props.onChangeText('Curry de garbanzos'));
    act(() => {
      findButtonByTitle(renderer, 'Crear').props.onPress();
    });

    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'recipes_limit' });
    expect(alertSpy).toHaveBeenCalledWith(
      'Límite alcanzado',
      expect.stringContaining('3 recetas'),
      expect.arrayContaining([expect.objectContaining({ text: 'Ver Pro', onPress: expect.any(Function) })])
    );

    // Pulsar "Ver Pro" del propio Alert abre ProModal.
    const verPro = alertSpy.mock.calls[0][2].find((b: { text: string }) => b.text === 'Ver Pro');
    expect(mockProModal).not.toHaveBeenCalled();
    act(() => verPro.onPress());
    expect(mockProModal).toHaveBeenCalledWith(expect.objectContaining({ isPro: false }));
  });

  it('con hueco libre (por debajo del límite), crear NO dispara paywall_viewed ni Alert', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    (useRecipeStore as unknown as jest.Mock).mockReturnValue({
      recipes: [{ id: 'r1' }], // por debajo del límite (3)
      fetchRecipes: jest.fn().mockResolvedValue(undefined),
      createRecipe: jest.fn().mockResolvedValue({ error: null }),
    });
    const renderer = renderRecipesScreen();
    openCreateModal(renderer);

    act(() => findInputByLabel(renderer, 'Nombre').props.onChangeText('Ensalada'));
    await act(async () => {
      await findButtonByTitle(renderer, 'Crear').props.onPress();
    });

    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
    expect(alertSpy).not.toHaveBeenCalledWith('Límite alcanzado', expect.anything(), expect.anything());
  });
});
