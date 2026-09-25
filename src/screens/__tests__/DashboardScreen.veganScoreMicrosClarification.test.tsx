/**
 * Auditoría del feedback nutricional de los primeros 7 días — la fila
 * "Micros clave" del desglose de VeganScore (en la tarjeta horizontal de
 * arriba) sólo cuenta 3 de los 6 micronutrientes que se ven justo debajo, en
 * la tarjeta "Micronutrientes (RDA)" (`computeNutritionParts`, en
 * `veganScore.ts`, sólo mira B12/hierro/vitamina D). Sin ninguna aclaración,
 * las dos tarjetas parecen hablar de lo mismo — un usuario con zinc/calcio/
 * omega-3 impecables pero B12/hierro/vitamina D bajos vería "Micros clave"
 * en rojo justo encima de una tarjeta de micros en verde, sin entender por
 * qué. Este test fija que la aclaración esté siempre presente y nombre
 * exactamente los 3 nutrientes que sí puntúan.
 *
 * Mismo arnés que `DashboardScreen.trendsCopy.test.tsx`.
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

function mockStores() {
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
    selectedDate: '2026-09-25',
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
    getVeganNutritionScoreTrend: jest.fn().mockResolvedValue([]),
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
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — aclaración de qué cuenta como "Micros clave" en VeganScore', () => {
  it('muestra la fila "Micros clave" junto a una aclaración de qué 3 nutrientes cuenta', async () => {
    mockStores();
    const renderer = await renderDashboard();
    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);

    expect(texts.some((c) => typeof c === 'string' && c === 'Micros clave')).toBe(true);
    expect(
      texts.some(
        (c) =>
          typeof c === 'string' &&
          c.includes('vitamina B12') &&
          c.includes('hierro') &&
          c.includes('vitamina D')
      )
    ).toBe(true);
  });

  it('la aclaración remite a la tarjeta "Micronutrientes (RDA)" donde están los otros 3', async () => {
    mockStores();
    const renderer = await renderDashboard();
    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);

    expect(texts.some((c) => typeof c === 'string' && c.includes('Micronutrientes (RDA)'))).toBe(true);
    // La propia tarjeta de detalle sigue existiendo con ese título exacto.
    expect(texts).toContain('Micronutrientes (RDA)');
  });
});
