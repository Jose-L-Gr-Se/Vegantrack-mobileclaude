/**
 * Auditoría de límites Free/Pro — `create()` no tenía ningún guard contra
 * doble tap. El límite free se comprobaba sólo al ENTRAR a la función
 * (`store.recipes.length >= FREE_RECIPE_LIMIT`): con exactamente 2 recetas
 * (una por debajo del límite de 3), dos toques rápidos en "Crear" —antes de
 * que el primero terminara y `store.recipes` reflejara la nueva receta—
 * veían ambos `length === 2` y creaban las dos, dejando 4 recetas para una
 * cuenta free con límite 3: el límite mostrado ("El plan free permite 3
 * recetas") dejaba de coincidir con el aplicado.
 *
 * Mismo arnés que `RecipesScreen.paywallDeadEnd.test.tsx`.
 */
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { RecipesScreen } from '@/screens/RecipesScreen';
import { useAuthStore } from '@/stores/authStore';
import { useRecipeStore } from '@/stores/recipeStore';
import { usePro } from '@/hooks/usePro';

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
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/recipeStore', () => ({
  useRecipeStore: jest.fn(),
  computeRecipeNutrients: () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, total_g: 0 }),
}));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn(), FREE_RECIPE_LIMIT: 3 }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

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

function openCreateModal(renderer: TestRenderer.ReactTestRenderer) {
  const [plusButton] = renderer.root.findAll((n) => typeof n.props.onPress === 'function');
  act(() => plusButton.props.onPress());
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('RecipesScreen — un doble tap en "Crear" no debe poder superar el límite free', () => {
  it('con 2 recetas (una por debajo del límite de 3), dos toques rápidos sólo crean una', async () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    let resolveCreate!: (v: { error: null }) => void;
    const createRecipe = jest.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    (useRecipeStore as unknown as jest.Mock).mockReturnValue({
      recipes: [{ id: 'r1' }, { id: 'r2' }], // 2 de 3 — hay hueco
      fetchRecipes: jest.fn().mockResolvedValue(undefined),
      createRecipe,
    });

    const renderer = renderRecipesScreen();
    openCreateModal(renderer);
    act(() => findInputByLabel(renderer, 'Nombre').props.onChangeText('Curry de garbanzos'));

    // Dos toques seguidos, antes de que el primero resuelva — se busca el
    // botón de nuevo cada vez, como haría un segundo toque real.
    act(() => {
      findButtonByTitle(renderer, 'Crear').props.onPress();
    });
    act(() => {
      findButtonByTitle(renderer, 'Crear').props.onPress();
    });
    await act(async () => {
      resolveCreate({ error: null });
      await Promise.resolve();
    });

    expect(createRecipe).toHaveBeenCalledTimes(1);
  });

  it('comportamiento normal (sin doble tap) sigue intacto: un solo toque crea una receta', async () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const createRecipe = jest.fn().mockResolvedValue({ error: null });
    (useRecipeStore as unknown as jest.Mock).mockReturnValue({
      recipes: [{ id: 'r1' }],
      fetchRecipes: jest.fn().mockResolvedValue(undefined),
      createRecipe,
    });

    const renderer = renderRecipesScreen();
    openCreateModal(renderer);
    act(() => findInputByLabel(renderer, 'Nombre').props.onChangeText('Ensalada'));
    await act(async () => {
      await findButtonByTitle(renderer, 'Crear').props.onPress();
    });

    expect(createRecipe).toHaveBeenCalledTimes(1);
  });
});
