/**
 * Bloque 1 de activación (Product Audit v2) — "onboarding_completed →
 * first_food_logged". Al llegar al Diario con `startAction: 'photo'` (desde
 * la nueva pantalla de activación post-onboarding), se abre directamente el
 * picker de análisis con IA — la misma vía que ya usa el CTA "Analizar
 * plato con IA" de esta pantalla, sin lógica nueva de captura — y, sólo en
 * ese caso, al guardar la comida se navega al Dashboard en vez de quedarse
 * en el Diario (el destino normal del resto de fotos del día a día).
 *
 * Mismo harness que DiaryScreen.supplementPaywall.test.tsx.
 */
import React from 'react';
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

// Prefijo `mock` a propósito: es la única forma en que Jest permite
// referenciar una variable de fuera desde dentro de un factory de
// `jest.mock` (ver mensaje de error de "out-of-scope variables").
let mockRouteParams: { startAction?: 'photo' } | undefined;
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

function baseMealPhoto(overrides: Partial<ReturnType<typeof defaultMealPhoto>> = {}) {
  return { ...defaultMealPhoto(), ...overrides };
}

function defaultMealPhoto() {
  return {
    analyzing: false,
    food: null as unknown,
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

/** La llamada más reciente a `ProductDetailSheet` con `food` (la ficha de
 * revisión del análisis con IA) — distinta de la de `editEntry`, que aquí
 * nunca se usa. */
function lastPhotoReviewSheetProps() {
  const calls = mockProductDetailSheet.mock.calls.map(([p]) => p as { food?: unknown });
  return calls.filter((p) => p.food).pop() as { onAdded: () => void; onClose: () => void } | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;

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
    selectedDate: '2026-09-08',
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
  (useMealPhoto as unknown as jest.Mock).mockReturnValue(baseMealPhoto());
});

describe('DiaryScreen — activación post-onboarding (startAction=photo)', () => {
  it('con startAction=photo, abre el picker de IA directamente y limpia el parámetro', () => {
    mockRouteParams = { startAction: 'photo' };
    renderDiaryScreen();

    expect(mockSetParams).toHaveBeenCalledWith({ startAction: undefined });
    const lastSheetCall = mockMealPhotoSheet.mock.calls.at(-1)?.[0] as { mode: string | null };
    expect(lastSheetCall.mode).toBe('picker');
  });

  it('sin startAction, no abre el picker por su cuenta', () => {
    renderDiaryScreen();
    expect(mockSetParams).not.toHaveBeenCalled();
    const lastSheetCall = mockMealPhotoSheet.mock.calls.at(-1)?.[0] as { mode: string | null };
    expect(lastSheetCall.mode).toBeNull();
  });

  it('al guardar la primera comida analizada desde activación, navega al Dashboard tras guardar', () => {
    mockRouteParams = { startAction: 'photo' };
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(
      baseMealPhoto({ food: { food_name: 'Tofu a la plancha' } })
    );
    renderDiaryScreen();

    const sheet = lastPhotoReviewSheetProps();
    expect(sheet).toBeDefined();
    act(() => sheet!.onAdded());

    expect(track).toHaveBeenCalledWith('photo_entry_saved', {});
    expect(mockNavigate).toHaveBeenCalledWith('Dashboard');
  });

  it('un análisis normal (sin venir de activación) al guardarse NO redirige al Dashboard', () => {
    // Sin startAction: el mismo flujo de foto de cualquier día normal.
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(
      baseMealPhoto({ food: { food_name: 'Lentejas' } })
    );
    renderDiaryScreen();

    const sheet = lastPhotoReviewSheetProps();
    act(() => sheet!.onAdded());

    expect(track).toHaveBeenCalledWith('photo_entry_saved', {});
    expect(mockNavigate).not.toHaveBeenCalledWith('Dashboard');
  });

  it('cancelar el picker abierto por activación no deja pendiente la redirección a Dashboard', () => {
    mockRouteParams = { startAction: 'photo' };
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(baseMealPhoto());
    const renderer = renderDiaryScreen();

    // Cancela el picker (p. ej. el usuario cierra la hoja sin elegir cámara/galería).
    const sheetProps = mockMealPhotoSheet.mock.calls.at(-1)?.[0] as { onClose: () => void };
    act(() => sheetProps.onClose());

    // Más tarde, en la misma visita, hace un análisis normal por su cuenta.
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(
      baseMealPhoto({ food: { food_name: 'Garbanzos' } })
    );
    act(() => {
      renderer.update(
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
          <DiaryScreen />
        </SafeAreaProvider>
      );
    });

    const sheet = lastPhotoReviewSheetProps();
    act(() => sheet!.onAdded());

    expect(mockNavigate).not.toHaveBeenCalledWith('Dashboard');
  });
});
