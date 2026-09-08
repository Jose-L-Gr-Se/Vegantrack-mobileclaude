/**
 * Auditoría del Diario — cierre del Bug E a nivel de UI: protección mínima
 * contra doble tap en "Copiar todo el día de ayer" mientras una copia está
 * en curso. Estado local de la propia pantalla (`copying`), sin ningún
 * sistema global nuevo.
 *
 * Mismo harness exacto que DiaryScreen.flushPending.test.tsx (componente
 * real vía react-test-renderer + act()).
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';

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
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));
jest.mock('@/components/MealPhotoSheet', () => ({ MealPhotoSheet: () => null }));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));
jest.mock('@/components/BottomSheet', () => ({ BottomSheet: () => null }));

const mockFetchEntries = jest.fn();
const mockFlushPending = jest.fn();
const mockDeleteEntry = jest.fn();

function baseDiaryStoreMock(overrides: Record<string, unknown> = {}) {
  return {
    entries: [],
    selectedDate: '2026-09-07',
    setDate: jest.fn(),
    fetchEntries: mockFetchEntries,
    deleteEntry: mockDeleteEntry,
    getDaySummary: () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }),
    copyDayEntries: jest.fn(),
    copyMealEntries: jest.fn(),
    loadOverrides: jest.fn().mockResolvedValue(undefined),
    flushPending: mockFlushPending,
    ...overrides,
  };
}

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

/** Mismo criterio que en otros tests de esta sesión: por props distintivos, no por identidad de tipo. */
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

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchEntries.mockResolvedValue(undefined);
  mockFlushPending.mockResolvedValue(undefined);
  mockDeleteEntry.mockResolvedValue({ error: null });

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

describe('DiaryScreen — protección de doble tap al copiar (auditoría del Diario, Bug E)', () => {
  it('8. dos pulsaciones casi simultáneas en "Copiar todo el día de ayer" → sólo una llamada efectiva a copyDayEntries mientras está en curso', async () => {
    let resolveCopy!: (v: { count: number; error: null }) => void;
    const mockCopyDayEntries = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveCopy = resolve;
        })
    );
    (useDiaryStore as unknown as jest.Mock).mockReturnValue(baseDiaryStoreMock({ copyDayEntries: mockCopyDayEntries }));

    const renderer = renderDiaryScreen();
    const copyButton = findButtonByTitle(renderer, 'Copiar todo el día de ayer');

    act(() => {
      copyButton.props.onPress(); // 1ª pulsación: dispara la copia, se queda "en curso"
    });
    act(() => {
      copyButton.props.onPress(); // 2ª pulsación inmediata: debe ignorarse (copying=true)
    });

    expect(mockCopyDayEntries).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCopy({ count: 1, error: null });
    });

    // Tras completarse la primera, una pulsación NUEVA sí vuelve a disparar.
    act(() => {
      copyButton.props.onPress();
    });
    expect(mockCopyDayEntries).toHaveBeenCalledTimes(2);
  });
});
