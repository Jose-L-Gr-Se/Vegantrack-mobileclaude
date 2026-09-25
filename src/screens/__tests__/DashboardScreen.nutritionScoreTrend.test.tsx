/**
 * Auditoría de histórico de VeganScore — integración del bloque
 * `VeganNutritionScoreTrend` en `DashboardScreen`. La agregación/puntuación
 * en sí ya se prueba en `veganScore.nutritionScore.test.ts` y
 * `diaryStore.veganNutritionScoreTrend.test.ts`; aquí sólo se comprueba que
 * la pantalla la conecta correctamente: con qué argumentos, para Free y Pro
 * por igual (7 días fijos en esta ronda), y que el bloque se renderiza.
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { usePro } from '@/hooks/usePro';
import { MICRO_RDA, ironRdaForSex } from '@/utils/nutrition';
import type { MicroAggregate } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Polyline: () => null,
  Circle: () => null,
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({ useSupplementStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mockGetVeganNutritionScoreTrend = jest.fn();

/** Agregado "suficiente" — sólo hace falta que `computeVeganScore` (el de
 * HOY, ya presente en la pantalla) no reviente; no es el objeto de este
 * archivo (ver `veganScore.nutritionScore.test.ts`/`DashboardScreen.
 * microRecommendations.test.tsx` para la lógica de micros en sí). */
function sufficientAgg(rda: number): MicroAggregate {
  return {
    value: rda, knownEntries: 1, totalEntries: 1, coverage: 1,
    knownGrams: 100, totalGrams: 100, coverageByGrams: 0.9, hasEntries: true,
  };
}
const SEX = 'female';
const sufficientMicros = {
  vitamin_b12_mcg: sufficientAgg(MICRO_RDA.vitamin_b12_mcg.rda),
  iron_mg: sufficientAgg(ironRdaForSex(SEX)),
  zinc_mg: sufficientAgg(MICRO_RDA.zinc_mg.rda),
  calcium_mg: sufficientAgg(MICRO_RDA.calcium_mg.rda),
  vitamin_d_mcg: sufficientAgg(MICRO_RDA.vitamin_d_mcg.rda),
  omega3_g: sufficientAgg(MICRO_RDA.omega3_g.rda),
};

function mockStores(isPro: boolean) {
  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    user: { id: 'user-1' },
    profile: {
      calorie_target: 2000,
      protein_target_g: 100,
      carbs_target_g: 250,
      fat_target_g: 70,
      streak_count: 0,
      sex: SEX,
    },
  });
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    selectedDate: '2026-09-24',
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
    getVeganNutritionScoreTrend: mockGetVeganNutritionScoreTrend,
    getDaySummary: () => ({
      calories: 1500,
      protein_g: 60,
      carbs_g: 180,
      fat_g: 50,
      fiber_g: 20,
      micros: sufficientMicros,
    }),
  });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    getTodayContributions: () => ({}),
    getTodayContributionDetails: () => [],
  });
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro });
}

async function renderDashboard() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <DashboardScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetVeganNutritionScoreTrend.mockResolvedValue([]);
});

describe('DashboardScreen — bloque de histórico de VeganScore nutricional', () => {
  it('pide 7 días con los objetivos y el sexo actuales del perfil', async () => {
    mockStores(false);
    await renderDashboard();

    expect(mockGetVeganNutritionScoreTrend).toHaveBeenCalledWith('user-1', 7, 2000, 100, 'female');
  });

  it('Free y Pro piden exactamente lo mismo: 7 días fijos, sin ampliar a 30/90 en esta ronda', async () => {
    mockStores(false);
    await renderDashboard();
    const freeArgs = mockGetVeganNutritionScoreTrend.mock.calls[0];

    jest.clearAllMocks();
    mockGetVeganNutritionScoreTrend.mockResolvedValue([]);
    mockStores(true);
    await renderDashboard();
    const proArgs = mockGetVeganNutritionScoreTrend.mock.calls[0];

    expect(freeArgs).toEqual(proArgs);
    expect(freeArgs[1]).toBe(7);
  });

  it('renderiza el bloque con los puntos recibidos, distinguiendo un día sin datos de un score real', async () => {
    mockStores(false);
    mockGetVeganNutritionScoreTrend.mockResolvedValue([
      { date: '2026-09-18', score: null },
      { date: '2026-09-19', score: { total: 88, calories: { score: 30, max: 30, label: '' }, protein: { score: 25, max: 25, label: '' }, micros: { score: 18, max: 20, label: '' }, fiber: { score: 15, max: 15, label: '' }, hasData: true } },
    ]);

    const renderer = await renderDashboard();

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((c) => typeof c === 'string' && c.includes('VeganScore nutricional'))).toBe(true);
  });
});
