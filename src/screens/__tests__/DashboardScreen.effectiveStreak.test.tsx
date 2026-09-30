/**
 * Racha efectiva en el VeganScore del Dashboard — la fila "Racha" leía
 * `profiles.streak_count` crudo aunque la racha ya estuviera rota. Ahora usa
 * la racha efectiva (viva sólo si el último registro fue hoy o ayer). Sólo
 * cambia el dato de entrada: ni la fórmula ni los tramos de VeganScore.
 *
 * Mismo arnés que `DashboardScreen.nutritionInsightAction.test.tsx`.
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
jest.mock('@/lib/foodLoggingHistory', () => ({ hasLoggedFood: () => Promise.resolve(false) }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

let streakProfile: { streak_count: number; last_log_date: string | null } = { streak_count: 0, last_log_date: null };

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
      ...streakProfile,
      sex: SEX,
    },
  });
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    selectedDate: '2026-09-19',
    // Una entrada con fecha de hoy: el Resumen está "en curso".
    entries: [{ date: todayISO() }],
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

import { Text } from 'react-native';
import { addDays, todayISO } from '@/utils/dates';

beforeEach(() => {
  jest.clearAllMocks();
});

/** Puntos de la fila "Racha" del desglose de VeganScore, tal cual se leen en pantalla (p. ej. "10/10"). */
async function rachaPoints(): Promise<string> {
  mockStores(micros());
  const r = await renderDashboard();
  const label = r.root.findAllByType(Text).find((n) => n.props.children === 'Racha')!;
  const points = label.parent!.findAllByType(Text)[1];
  return [].concat(points.props.children).join('');
}

describe('DashboardScreen — la fila "Racha" del VeganScore usa la racha efectiva', () => {
  it('vigente (ayer, 10 días): puntúa el tramo >= 7 → "10/10"', async () => {
    streakProfile = { streak_count: 10, last_log_date: addDays(todayISO(), -1) };
    expect(await rachaPoints()).toBe('10/10');
  });

  it('rota (hace 4 días): "0/10", aunque el perfil aún guarde 10', async () => {
    streakProfile = { streak_count: 10, last_log_date: addDays(todayISO(), -4) };
    expect(await rachaPoints()).toBe('0/10');
  });

  it('sin fecha de último registro: "0/10" (nunca se inventa una racha)', async () => {
    streakProfile = { streak_count: 10, last_log_date: null };
    expect(await rachaPoints()).toBe('0/10');
  });
});
