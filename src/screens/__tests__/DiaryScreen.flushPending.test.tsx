/**
 * P1 de sincronización — Fase 3 (ver auditoría): enganchar `flushPending`
 * en los puntos de la UI donde ya se refresca desde remoto (foco de
 * pantalla, pull-to-refresh), reutilizando las funciones existentes de los
 * stores — sin ninguna lógica de sync nueva ni un segundo mutex.
 *
 * Renderiza el componente real (react-test-renderer + act(), mismo
 * precedente que ProductDetailSheet.nutritionQuality.test.tsx). Todo lo que
 * no es relevante para esta ronda (ProductDetailSheet, MealPhotoSheet,
 * SupplementEditor, BottomSheet, ProModal — este último arrastra
 * react-native-purchases, un módulo nativo) se mockea como stand-in trivial;
 * ninguno de ellos se renderiza en el estado inicial de la pantalla, así que
 * esto no oculta ningún comportamiento bajo prueba.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';

// @/theme -> themeStore -> @/db/database no resuelve expo-sqlite en este
// entorno de Jest (mismo motivo que en tests anteriores de esta ronda).
jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-navigation/native', () => ({
  // Simula "la pantalla tiene el foco": ejecuta el callback al montar, igual
  // que un useEffect con deps vacías. No reproduce cada matiz de la API real
  // (reenfoque tras navegar) — sólo lo necesario para esta prueba: que el
  // efecto se dispare al entrar a la pantalla.
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ navigate: jest.fn() }),
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

// Ninguno se renderiza en el estado inicial de esta pantalla (editing=null,
// photo.food=null, suppEditor=null) — se mockean para no arrastrar sus
// propias dependencias (mealVision, customFoodStore, react-native-purchases
// en ProModal, etc.), irrelevantes para lo que se prueba aquí.
jest.mock('@/components/ProductDetailSheet', () => ({ ProductDetailSheet: () => null }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));
jest.mock('@/components/MealPhotoSheet', () => ({ MealPhotoSheet: () => null }));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));
jest.mock('@/components/BottomSheet', () => ({ BottomSheet: () => null }));

const mockFetchEntries = jest.fn();
const mockDeleteEntry = jest.fn();

function baseDiaryStoreMock(overrides: Record<string, unknown> = {}) {
  return {
    entries: [],
    selectedDate: '2026-09-06',
    setDate: jest.fn(),
    fetchEntries: mockFetchEntries,
    deleteEntry: mockDeleteEntry,
    getDaySummary: () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }),
    copyDayEntries: jest.fn(),
    copyMealEntries: jest.fn(),
    loadOverrides: jest.fn().mockResolvedValue(undefined),
    flushPending: jest.fn().mockResolvedValue(undefined),
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

/** RefreshControl real de RN — se busca por sus props distintivos, no por
 *  identidad de tipo (ver nota histórica sobre módulos duplicados en este
 *  sandbox para Pressable/otros componentes de react-native). */
function findRefreshControl(renderer: TestRenderer.ReactTestRenderer) {
  const [node] = renderer.root.findAll(
    (n) => typeof n.props.onRefresh === 'function' && typeof n.props.refreshing === 'boolean'
  );
  return node;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchEntries.mockResolvedValue(undefined);
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
  (useDiaryStore as unknown as jest.Mock).mockReturnValue(baseDiaryStoreMock());
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

describe('DiaryScreen — Fase 3 del P1 de sincronización', () => {
  it('1. entrar en Diario (foco) dispara fetchEntries Y flushPending, para el mismo usuario/fecha', () => {
    const mockFlushPending = jest.fn().mockResolvedValue(undefined);
    (useDiaryStore as unknown as jest.Mock).mockReturnValue(baseDiaryStoreMock({ flushPending: mockFlushPending }));

    renderDiaryScreen();

    expect(mockFetchEntries).toHaveBeenCalledWith('user-1', '2026-09-06');
    expect(mockFlushPending).toHaveBeenCalledWith('user-1');
  });

  it('2. pull-to-refresh dispara fetchEntries Y flushPending', async () => {
    const mockFlushPending = jest.fn().mockResolvedValue(undefined);
    (useDiaryStore as unknown as jest.Mock).mockReturnValue(baseDiaryStoreMock({ flushPending: mockFlushPending }));

    const renderer = renderDiaryScreen();
    // El montaje (foco) ya dispara una llamada a cada una — se limpian para
    // que este test aísle específicamente lo que dispara el refresh.
    mockFetchEntries.mockClear();
    mockFlushPending.mockClear();

    const refreshControl = findRefreshControl(renderer);
    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    expect(mockFetchEntries).toHaveBeenCalledWith('user-1', '2026-09-06');
    expect(mockFlushPending).toHaveBeenCalledWith('user-1');
  });

  it('3. dos disparos en rápida sucesión (foco + refresh inmediato) no generan flushes duplicados — el mutex existente de flushPending es quien lo decide, la pantalla no añade el suyo', async () => {
    // Modela el mismo guard síncrono de la Fase 1 (flushInFlight): la
    // pantalla no sabe nada de esto, sólo llama a flushPending() dos veces
    // seguidas de forma ingenua — es la propia función la que se protege.
    let inFlight = false;
    let effectiveRuns = 0;
    const mutexAwareFlush = jest.fn(async () => {
      if (inFlight) return;
      inFlight = true;
      effectiveRuns++;
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight = false;
    });
    (useDiaryStore as unknown as jest.Mock).mockReturnValue(baseDiaryStoreMock({ flushPending: mutexAwareFlush }));

    // El montaje (foco) ya deja una primera pasada "en curso" (aún no ha
    // resuelto su timer simulado).
    const renderer = renderDiaryScreen();

    const refreshControl = findRefreshControl(renderer);
    await act(async () => {
      // onRefresh llama a flushPending de forma síncrona (antes de su
      // propio await a fetchEntries) — en ese instante la primera pasada
      // del montaje sigue "en curso" (inFlight aún true), así que esta
      // segunda llamada debe ser un no-op inmediato.
      await refreshControl.props.onRefresh();
    });
    // Deja resolver el timer simulado de la primera pasada.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mutexAwareFlush).toHaveBeenCalledTimes(2); // la pantalla sí llamó dos veces...
    expect(effectiveRuns).toBe(1); // ...pero sólo una fue efectiva.
  });
});
