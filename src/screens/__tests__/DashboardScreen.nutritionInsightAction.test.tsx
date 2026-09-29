/**
 * Nutrition Insight accionable — la prioridad de "Qué vigilar hoy" ahora
 * ofrece una acción concreta ("Ver alimentos") que lleva a la pestaña de
 * Buscar ya existente, contextualizada con ese micro. La regla de qué
 * cuenta como prioridad (confianza/pct/máximo 3) ya está cubierta en
 * `nutritionInsight.test.ts` (pura) y en `DashboardScreen.microRecommendations
 * .test.tsx`; aquí sólo se comprueba que la acción aparece cuando toca y que
 * navega con el contexto correcto — nunca una recomendación de cantidad, el
 * usuario decide qué buscar y añadir.
 *
 * Mismo arnés que `DashboardScreen.microRecommendations.test.tsx`, con
 * `mockNavigate` capturable (mismo patrón que `SearchScreen.activation.test.tsx`)
 * para poder aserar la navegación.
 */
import React from 'react';
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
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Polyline: () => null }));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({ useSupplementStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const SEX = 'female'; // ironRdaForSex('female') = 18

function sufficientAgg(rda: number): MicroAggregate {
  return {
    value: rda,
    knownEntries: 1,
    totalEntries: 1,
    coverage: 1,
    knownGrams: 100,
    totalGrams: 100,
    coverageByGrams: 0.9, // → confidence 'high'
    hasEntries: true,
  };
}

function lowValueAgg(rda: number, coverageByGrams: number): MicroAggregate {
  return {
    value: rda * 0.2,
    knownEntries: 1,
    totalEntries: 1,
    coverage: coverageByGrams,
    knownGrams: coverageByGrams * 100,
    totalGrams: 100,
    coverageByGrams,
    hasEntries: true,
  };
}

const RDAS = {
  vitamin_b12_mcg: MICRO_RDA.vitamin_b12_mcg.rda,
  iron_mg: ironRdaForSex(SEX),
  zinc_mg: MICRO_RDA.zinc_mg.rda,
  calcium_mg: MICRO_RDA.calcium_mg.rda,
  vitamin_d_mcg: MICRO_RDA.vitamin_d_mcg.rda,
  omega3_g: MICRO_RDA.omega3_g.rda,
} as const;

function micros(overrides: Partial<Record<keyof typeof RDAS, MicroAggregate>> = {}) {
  const base = Object.fromEntries(
    (Object.keys(RDAS) as (keyof typeof RDAS)[]).map((k) => [k, sufficientAgg(RDAS[k])])
  ) as Record<keyof typeof RDAS, MicroAggregate>;
  return { ...base, ...overrides };
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

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

function mockStores(microsOverride: ReturnType<typeof micros>) {
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
    selectedDate: '2026-09-19',
    setDate: jest.fn(),
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
    getVeganNutritionScoreTrend: jest.fn().mockResolvedValue([]),
    getMicroTrends: jest.fn().mockResolvedValue([]),
    getDaySummary: () => ({
      calories: 1500,
      protein_g: 60,
      carbs_g: 180,
      fat_g: 50,
      fiber_g: 20,
      micros: microsOverride,
    }),
  });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    getTodayContributions: () => ({}),
    getTodayContributionDetails: () => [],
  });
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
}

/** Encuentra el Pressable cuyo hijo directo o indirecto es el texto exacto
 *  dado, y simula tocarlo. */
function pressNodeContaining(renderer: TestRenderer.ReactTestRenderer, text: string) {
  const matches = renderer.root.findAll((n) => n.props.children === text);
  let node = matches[0];
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — Nutrition Insight accionable ("Ver alimentos")', () => {
  it('una prioridad con confianza suficiente muestra la acción "Ver alimentos"', async () => {
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) })); // coverageByGrams 0.9 → 'high'
    const renderer = await renderDashboard();
    expect(JSON.stringify(renderer.toJSON())).toContain('Ver alimentos');
  });

  it('tocar "Ver alimentos" navega a Buscar con el nutriente de esa prioridad como contexto', async () => {
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) }));
    const renderer = await renderDashboard();

    pressNodeContaining(renderer, 'Ver alimentos');

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Search', params: { nutrient: 'iron_mg' } });
  });

  it('una prioridad sin confianza suficiente (low) no genera ninguna acción, igual que no genera prioridad', async () => {
    mockStores(micros({ calcium_mg: lowValueAgg(RDAS.calcium_mg, 0.2) })); // coverageByGrams 0.2 → 'low'
    const renderer = await renderDashboard();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Ver alimentos');
  });

  it('sin ninguna prioridad (todos los micros suficientes) no aparece ninguna acción', async () => {
    mockStores(micros());
    const renderer = await renderDashboard();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Ver alimentos');
  });
});
