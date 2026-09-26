/**
 * Auditoría del histórico y navegación por días — el estado vacío del Diario
 * decía siempre "Aún no has registrado nada HOY", sin importar qué fecha
 * estuviera seleccionada. Al navegar a un día pasado sin registros (Diario →
 * ‹) el mensaje seguía diciendo "hoy", contradiciendo la fecha mostrada justo
 * arriba (`formatDateHuman(selectedDate)`) — el contenido del estado vacío no
 * correspondía a la fecha seleccionada.
 *
 * Mismo harness que `DiaryScreen.mealSavedToast.test.tsx`.
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';
import { todayISO, addDays } from '@/utils/dates';

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
jest.mock('@/components/ProductDetailSheet', () => ({ ProductDetailSheet: () => null }));
jest.mock('@/components/MealPhotoSheet', () => ({ MealPhotoSheet: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function defaultMealPhoto() {
  return {
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
    applyManualVeganCorrection: jest.fn(),
  };
}

function mockStores(selectedDate: string) {
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
    selectedDate,
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

function allTexts(renderer: TestRenderer.ReactTestRenderer): unknown[] {
  return renderer.root.findAllByType(Text).map((t) => t.props.children);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DiaryScreen — el estado vacío corresponde a la fecha seleccionada, no siempre a "hoy"', () => {
  it('sin registros HOY: mensaje "hoy"', () => {
    mockStores(todayISO());
    const renderer = renderDiaryScreen();
    const texts = allTexts(renderer);

    expect(texts).toContain('Aún no has registrado nada hoy. Toca ＋ en una comida para buscar alimentos.');
  });

  it('sin registros en un día PASADO: nunca dice "hoy" — el mensaje es neutro respecto a la fecha', () => {
    mockStores(addDays(todayISO(), -3));
    const renderer = renderDiaryScreen();
    const texts = allTexts(renderer);

    expect(texts).toContain('No hay nada registrado este día. Toca ＋ en una comida para añadir algo.');
    // Nunca el mensaje de "hoy" (distinto del título "Suplementos de hoy",
    // que sí es correcto: los suplementos son siempre de hoy, no de la fecha
    // seleccionada en el Diario — fuera de alcance de esta auditoría).
    expect(texts).not.toContain('Aún no has registrado nada hoy. Toca ＋ en una comida para buscar alimentos.');
  });
});
