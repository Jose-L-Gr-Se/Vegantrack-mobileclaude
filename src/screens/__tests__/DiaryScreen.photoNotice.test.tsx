/**
 * Auditoría del flujo de foto-IA — `photoNotice` (el aviso mostrado en la
 * ficha de revisión tras analizar una foto). Antes, si el plato se marcaba
 * como no vegano CON ingredientes reportados, ese aviso sustituía
 * completamente a `analysis.notes` — cualquier incertidumbre que la propia
 * IA señalara (ración poco clara, ingrediente no identificado con certeza…)
 * se perdía en silencio justo cuando más se necesita para confiar en la
 * estimación. Ahora ambos avisos son independientes y se muestran juntos
 * cuando los dos existen.
 *
 * Mismo harness que `DiaryScreen.activation.test.tsx` (mock de
 * `ProductDetailSheet` para inspeccionar con qué `notice` se le invoca).
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';
import type { MealAnalysis } from '@/lib/mealVision';

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
jest.mock('@/components/MealPhotoSheet', () => ({ MealPhotoSheet: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function baseAnalysis(over: Partial<MealAnalysis> = {}): MealAnalysis {
  return {
    is_food: true,
    food_name: 'Plato fotografiado',
    estimated_grams: 200,
    per_100g: { calories: 100, protein_g: 5, carbs_g: 10, fat_g: 2, fiber_g: 1, sugar_g: 1, saturated_fat_g: 0.5 },
    is_vegan: true,
    vegan_confidence: 'high',
    non_vegan_ingredients: [],
    ...over,
  };
}

function mealPhotoWith(analysis: MealAnalysis | null) {
  return {
    analyzing: false,
    food: analysis ? { food_name: analysis.food_name } : null,
    analysis,
    grams: 100,
    confidence: undefined,
    remaining: null,
    limit: 5,
    quotaBlocked: false,
    error: null,
    capture: jest.fn(),
    retry: jest.fn(),
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

function lastPhotoReviewNotice() {
  const calls = mockProductDetailSheet.mock.calls.map(([p]) => p as { food?: unknown; notice?: unknown });
  return calls.filter((p) => p.food).pop()?.notice as { tone: string; text: string } | null | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
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
});

describe('DiaryScreen — photoNotice combina ingredientes no veganos y notas de la IA', () => {
  it('sólo ingredientes no veganos: se muestra ese aviso', () => {
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(
      mealPhotoWith(baseAnalysis({ is_vegan: false, non_vegan_ingredients: ['gelatina'] }))
    );
    renderDiaryScreen();

    expect(lastPhotoReviewNotice()?.text).toBe(
      'Posibles ingredientes de origen animal: gelatina (sólo informativo).'
    );
  });

  it('sólo notas de incertidumbre (plato vegano): se muestran las notas', () => {
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(
      mealPhotoWith(baseAnalysis({ notes: 'No se aprecia bien la ración de arroz.' }))
    );
    renderDiaryScreen();

    expect(lastPhotoReviewNotice()?.text).toBe('No se aprecia bien la ración de arroz.');
  });

  it('ingredientes no veganos Y notas a la vez: antes las notas se perdían — ahora se muestran ambos', () => {
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(
      mealPhotoWith(
        baseAnalysis({
          is_vegan: false,
          non_vegan_ingredients: ['queso'],
          notes: 'No se identifica con certeza la salsa.',
        })
      )
    );
    renderDiaryScreen();

    const notice = lastPhotoReviewNotice();
    expect(notice?.text).toContain('Posibles ingredientes de origen animal: queso (sólo informativo).');
    expect(notice?.text).toContain('No se identifica con certeza la salsa.');
  });

  it('sin ingredientes no veganos ni notas: no hay aviso', () => {
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(mealPhotoWith(baseAnalysis()));
    renderDiaryScreen();

    expect(lastPhotoReviewNotice()).toBeNull();
  });

  it('sin análisis todavía: no hay aviso (no revienta)', () => {
    (useMealPhoto as unknown as jest.Mock).mockReturnValue(mealPhotoWith(null));
    renderDiaryScreen();

    expect(mockProductDetailSheet).not.toHaveBeenCalledWith(expect.objectContaining({ food: expect.anything() }));
  });
});
