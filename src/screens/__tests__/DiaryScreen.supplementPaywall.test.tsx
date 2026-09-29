/**
 * Auditoría de instrumentación del funnel — cierre del dead-end de
 * suplementos en el Diario: alcanzar el límite free ya no deja al usuario en
 * un `Alert` sin salida. Ahora ofrece "Ver Pro" (abre `ProModal`) y mide
 * `paywall_viewed` con `source: 'supplements_limit'`.
 *
 * Mismo harness que DiaryScreen.copyEntries.test.tsx.
 */
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ navigate: jest.fn(), setParams: jest.fn() }),
  // Sin `startAction` (Bloque 1 de activación): no aplica a esta ronda de
  // pruebas, ninguna de ellas depende de la navegación de activación.
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

jest.mock('@/components/ProductDetailSheet', () => ({ ProductDetailSheet: () => null }));
jest.mock('@/components/MealPhotoSheet', () => ({ MealPhotoSheet: () => null }));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));
jest.mock('@/components/BottomSheet', () => ({ BottomSheet: () => null }));

const mockProModal = jest.fn((_props: unknown) => null);
jest.mock('@/components/ProModal', () => ({ ProModal: (props: unknown) => mockProModal(props) }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

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

/** El "+" de suplementos: se localiza por su icono único (`name="add"`) y se
 * sube al Pressable padre con `onPress`. */
function findAddSupplementButton(renderer: TestRenderer.ReactTestRenderer) {
  let node = renderer.root.findByProps({ name: 'add' });
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

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
    selectedDate: '2026-09-07',
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
    supplements: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], // ya en el límite free (3)
    takenToday: {},
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    toggleTaken: jest.fn(),
    createSupplement: jest.fn(),
    updateSupplement: jest.fn(),
    deleteSupplement: jest.fn(),
  });
  (useMealPhoto as unknown as jest.Mock).mockReturnValue({
    analyzing: false,
    food: null,
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
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('DiaryScreen — cierre del dead-end de paywall de suplementos', () => {
  it('alcanzar el límite free mide paywall_viewed(supplements_limit) y el Alert ofrece "Ver Pro" que abre ProModal', () => {
    const renderer = renderDiaryScreen();

    act(() => findAddSupplementButton(renderer).props.onPress());

    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'supplements_limit' });
    expect(alertSpy).toHaveBeenCalledWith(
      'Límite alcanzado',
      expect.stringContaining('3 suplementos'),
      expect.arrayContaining([expect.objectContaining({ text: 'Ver Pro', onPress: expect.any(Function) })])
    );

    const verPro = alertSpy.mock.calls[0][2].find((b: { text: string }) => b.text === 'Ver Pro');
    expect(mockProModal).not.toHaveBeenCalled();
    act(() => verPro.onPress());
    expect(mockProModal).toHaveBeenCalledWith(expect.objectContaining({ isPro: false }));
  });
});
