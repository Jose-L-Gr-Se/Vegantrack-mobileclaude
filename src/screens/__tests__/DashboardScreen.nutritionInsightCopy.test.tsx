/**
 * Semántica del patrón semanal en el Dashboard — el copy de "Qué vigilar hoy"
 * describe LO REGISTRADO, nunca la ingesta real, y el denominador de un patrón
 * es siempre el nº real de días con datos (no el tamaño de la ventana). La
 * regla de qué es un patrón vive en `nutritionInsight.test.ts` (pura); aquí
 * sólo se comprueba lo que el usuario llega a leer.
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
import { todayISO } from '@/utils/dates';
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

function mockStores(microsOverride: ReturnType<typeof micros>, history: unknown[] = []) {
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
    // Una entrada con fecha de hoy: el Resumen está "en curso".
    entries: [{ date: todayISO() }],
    setDate: jest.fn(),
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
    getVeganNutritionScoreTrend: jest.fn().mockResolvedValue([]),
    getMicroTrends: jest.fn().mockResolvedValue(history),
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

/** Un día previo del historial: sólo el hierro importa; el resto, "suficiente y fiable". */
function historyDay(iron: { pct: number; hasEntries: boolean; confidence: string }) {
  const ok = { pct: 1, hasEntries: true, confidence: 'high' };
  return {
    date: '2026-09-01',
    micros: {
      vitamin_b12_mcg: ok, iron_mg: iron, zinc_mg: ok, calcium_mg: ok, vitamin_d_mcg: ok, omega3_g: ok,
    },
  };
}
const LOW = { pct: 0.2, hasEntries: true, confidence: 'high' };
const GOOD = { pct: 1, hasEntries: true, confidence: 'high' };
const NO_DATA = { pct: 0, hasEntries: false, confidence: 'none' };

/** 6 días previos + el punto de hoy que DashboardScreen descarta (`slice(0, -1)`). */
function week(previous: ReturnType<typeof historyDay>[]) {
  return [...previous, historyDay(GOOD)];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — "Qué vigilar hoy" describe lo registrado', () => {
  it('el subtítulo aclara que son observaciones sobre lo registrado, no sobre toda la alimentación', async () => {
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) }));
    const text = JSON.stringify((await renderDashboard()).toJSON());

    expect(text).toContain('Observaciones sobre lo que has registrado, no sobre toda tu alimentación. No es un diagnóstico.');
    // El texto anterior ("...registrado hoy") era inexacto para las filas de patrón (usan hasta 7 días).
    expect(text).not.toContain('Basado en lo que has registrado hoy');
  });

  it('sin histórico: la prioridad de hoy se lee como observación del registro de hoy', async () => {
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) }));
    const text = JSON.stringify((await renderDashboard()).toJSON());

    expect(text).toContain('lo registrado hoy es bajo');
    expect(text).toContain('% del objetivo');
  });

  it('patrón con 4 días válidos: el copy dice "3 de los últimos 4 días con datos", nunca 7', async () => {
    // Hoy (bajo) + 3 previos válidos (2 bajos, 1 cubierto) + 3 sin datos → 3 de 4.
    const previous = [historyDay(LOW), historyDay(LOW), historyDay(GOOD), historyDay(NO_DATA), historyDay(NO_DATA), historyDay(NO_DATA)];
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) }), week(previous));
    const text = JSON.stringify((await renderDashboard()).toJSON());

    expect(text).toContain('lo registrado quedó bajo en 3 de los últimos 4 días con datos');
    expect(text).not.toContain('de los últimos 7');
    // Copy anterior, ya retirado.
    expect(text).not.toContain('bajo varios días seguidos');
  });

  it('patrón con 7 días válidos: "5 de los últimos 7 días con datos"', async () => {
    const previous = [LOW, LOW, LOW, LOW, GOOD, GOOD].map(historyDay);
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) }), week(previous));
    const text = JSON.stringify((await renderDashboard()).toJSON());

    expect(text).toContain('lo registrado quedó bajo en 5 de los últimos 7 días con datos');
  });

  it('nada del copy visible usa lenguaje de déficit, carencia o diagnóstico', async () => {
    const previous = [LOW, LOW, LOW, LOW, GOOD, GOOD].map(historyDay);
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) }), week(previous));
    const text = JSON.stringify((await renderDashboard()).toJSON()).toLowerCase();

    expect(text).not.toMatch(/d[eé]ficit|carencia|deficien/);
  });
});
