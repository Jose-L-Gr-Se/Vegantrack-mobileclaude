/**
 * Racha efectiva en el Diario — `profiles.streak_count` es la racha que TERMINA
 * en `last_log_date` y no se recalcula por el paso del tiempo: una racha rota
 * seguía mostrando "🔥 Racha: N días" hasta el siguiente registro. Ahora el
 * Diario sólo la muestra si sigue viva (último registro hoy o ayer), sin
 * mutar el perfil.
 *
 * Mismo harness que `DiaryScreen.emptyStateDate.test.tsx`.
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

function mockStores(streak: { streak_count: number; last_log_date: string | null }) {
  const selectedDate = todayISO();
  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    user: { id: 'user-1' },
    profile: {
      calorie_target: 2000,
      protein_target_g: 100,
      carbs_target_g: 250,
      fat_target_g: 70,
      ...streak,
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

const shown = (r: TestRenderer.ReactTestRenderer) => allTexts(r).some((c) => Array.isArray(c) ? c.join('').includes('🔥 Racha:') : typeof c === 'string' && c.includes('🔥 Racha:'));
const streakText = (r: TestRenderer.ReactTestRenderer) =>
  allTexts(r).map((c) => (Array.isArray(c) ? c.join('') : String(c))).find((c) => c.includes('🔥 Racha:'));

describe('DiaryScreen — racha efectiva', () => {
  it('vigente (último registro AYER): muestra la racha guardada', () => {
    mockStores({ streak_count: 10, last_log_date: addDays(todayISO(), -1) });
    expect(streakText(renderDiaryScreen())).toBe('🔥 Racha: 10 días');
  });

  it('vigente (último registro HOY): la muestra', () => {
    mockStores({ streak_count: 4, last_log_date: todayISO() });
    expect(streakText(renderDiaryScreen())).toBe('🔥 Racha: 4 días');
  });

  it('rota (último registro hace 3 días): NO muestra la racha guardada aunque siga en el perfil', () => {
    mockStores({ streak_count: 10, last_log_date: addDays(todayISO(), -3) });
    expect(shown(renderDiaryScreen())).toBe(false);
  });

  it('sin racha o sin fecha: no muestra nada', () => {
    mockStores({ streak_count: 0, last_log_date: null });
    expect(shown(renderDiaryScreen())).toBe(false);
  });
});
