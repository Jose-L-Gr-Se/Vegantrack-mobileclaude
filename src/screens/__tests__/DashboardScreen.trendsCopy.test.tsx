/**
 * Copy del acceso a "Tendencias de micros" en el Dashboard (auditoría de
 * experiencia de retorno 3/7/14 días, ronda de corrección de copy): ahora
 * que Free puede ver 7 días, ni el badge ni el subtítulo deben sugerir que
 * toda la función es Pro — deben comunicar los dos niveles: 7 días gratis,
 * 30/90 con Pro. No toca lógica de navegación/paywall/analytics, sólo texto.
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
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Polyline: () => null }));

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

const SEX = 'female';

/** Agregado "suficiente" para las 6 micros — sólo necesitamos que
 * `computeVeganScore`/el desglose de micros no revienten al montar; el
 * contenido no es el objeto de este test (ver
 * `DashboardScreen.microRecommendations.test.tsx` para esa lógica). */
function sufficientMicros(): Record<string, MicroAggregate> {
  const rdas: Record<string, number> = {
    vitamin_b12_mcg: MICRO_RDA.vitamin_b12_mcg.rda,
    iron_mg: ironRdaForSex(SEX),
    zinc_mg: MICRO_RDA.zinc_mg.rda,
    calcium_mg: MICRO_RDA.calcium_mg.rda,
    vitamin_d_mcg: MICRO_RDA.vitamin_d_mcg.rda,
    omega3_g: MICRO_RDA.omega3_g.rda,
  };
  return Object.fromEntries(
    Object.entries(rdas).map(([key, rda]) => [
      key,
      {
        value: rda,
        knownEntries: 1,
        totalEntries: 1,
        coverage: 1,
        knownGrams: 100,
        totalGrams: 100,
        coverageByGrams: 0.9,
        hasEntries: true,
      },
    ])
  );
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
    selectedDate: '2026-09-19',
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
    getDaySummary: () => ({
      calories: 1500,
      protein_g: 60,
      carbs_g: 180,
      fat_g: 50,
      fiber_g: 20,
      micros: sufficientMicros(),
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — copy del acceso a Tendencias de micros', () => {
  it('Free: el subtítulo comunica 7 días gratis y que Pro desbloquea 30/90, sin badge "PRO"', async () => {
    mockStores(false);
    const renderer = await renderDashboard();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('7 días gratis · Pro desbloquea 30 y 90 días');
    // Regresión del badge anterior, que sugería que todo el acceso era Pro.
    expect(renderer.root.findAllByType(Text).some((n) => n.props.children === 'PRO')).toBe(false);
  });

  it('Pro: subtítulo sin gating, sin badge "PRO"', async () => {
    mockStores(true);
    const renderer = await renderDashboard();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('Evolución de B12, hierro y omega-3 · 7, 30 y 90 días');
    expect(text).not.toContain('7 días gratis · Pro desbloquea 30 y 90 días');
    expect(renderer.root.findAllByType(Text).some((n) => n.props.children === 'PRO')).toBe(false);
  });
});
