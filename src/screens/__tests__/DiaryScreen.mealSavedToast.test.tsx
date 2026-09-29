/**
 * Auditoría del loop "siguiente comida" — guardar un análisis de foto-IA
 * desde el Diario no daba NINGUNA confirmación visible (a diferencia de
 * Buscar, que sí ponía un mensaje, aunque quedara oculto por el cambio de
 * pestaña — ver `SearchScreen.mealSavedToast.test.tsx`): el usuario sólo
 * sabía que se había guardado si se fijaba en que la entrada apareciera en
 * la lista. Ahora usa la misma confirmación global que el resto de la app.
 *
 * Mismo harness que `DiaryScreen.activation.test.tsx`.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';
import { useUiStore } from '@/stores/uiStore';

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
jest.mock('@/stores/supplementStore', () => ({
  useSupplementStore: jest.fn(),
  SUPPLEMENT_PRESETS: [],
}));
jest.mock('@/hooks/useMealPhoto', () => ({ useMealPhoto: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({
  usePro: jest.fn(() => ({ isPro: false })),
  FREE_HISTORY_DAYS: 14,
  FREE_SUPPLEMENT_LIMIT: 3,
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn(), trackAppOpenOnce: jest.fn() }));

jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));
jest.mock('@/components/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const mockProductDetailSheet = jest.fn((_props: unknown) => null);
jest.mock('@/components/ProductDetailSheet', () => ({
  ProductDetailSheet: (props: unknown) => mockProductDetailSheet(props),
}));
const mockMealPhotoSheet = jest.fn((_props: unknown) => null);
jest.mock('@/components/MealPhotoSheet', () => ({
  MealPhotoSheet: (props: unknown) => mockMealPhotoSheet(props),
}));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function defaultMealPhoto() {
  return {
    analyzing: false,
    food: { food_name: 'Tofu a la plancha' } as unknown,
    analysis: null,
    grams: 100,
    confidence: undefined,
    remaining: null,
    limit: 5,
    quotaBlocked: false,
    error: null,
    capture: jest.fn(),
    reset: jest.fn(),
    clearError: jest.fn(),
    clearQuota: jest.fn(),
    applyCorrection: jest.fn(),
    applyManualVeganCorrection: jest.fn(),
  };
}

function renderDiaryScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <DiaryScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function lastPhotoReviewSheetProps() {
  const calls = mockProductDetailSheet.mock.calls.map(([p]) => p as { food?: unknown });
  return calls.filter((p) => p.food).pop() as { onAdded: (msg: string) => void } | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  act(() => useUiStore.setState({ mealSavedToast: null }));

  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    user: { id: 'user-1' },
    profile: {
      calorie_target: 2000,
      protein_target_g: 100,
      carbs_target_g: 250,
      fat_target_g: 70,
      streak_count: 0,
    },
  });
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    entries: [],
    selectedDate: '2026-09-25',
    setDate: jest.fn(),
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    deleteEntry: jest.fn(),
    getDaySummary: () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }),
    copyDayEntries: jest.fn(),
    copyMealEntries: jest.fn(),
    loadOverrides: jest.fn().mockResolvedValue(undefined),
    flushPending: jest.fn().mockResolvedValue(undefined),
  });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    supplements: [],
    takenToday: {},
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    toggleTaken: jest.fn(),
    createSupplement: jest.fn(),
    updateSupplement: jest.fn(),
    deleteSupplement: jest.fn(),
  });
  (useMealPhoto as unknown as jest.Mock).mockReturnValue(defaultMealPhoto());
});

describe('DiaryScreen — confirmación tras guardar un análisis de foto-IA', () => {
  it('al guardar, muestra el mensaje de confirmación en useUiStore().mealSavedToast', () => {
    renderDiaryScreen();

    const sheet = lastPhotoReviewSheetProps();
    expect(sheet).toBeDefined();
    act(() => sheet!.onAdded('Tofu a la plancha añadido a Comida'));

    expect(useUiStore.getState().mealSavedToast).toBe('Tofu a la plancha añadido a Comida');
  });
});
