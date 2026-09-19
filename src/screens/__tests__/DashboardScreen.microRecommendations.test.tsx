/**
 * Dashboard accionable — integración de `microRecommendationText` en la
 * tarjeta "Micronutrientes (RDA)" de `DashboardScreen`. La regla de decisión
 * en sí ya está cubierta en `microRecommendations.test.ts` (pura); aquí sólo
 * se comprueba que la pantalla la conecta correctamente: qué se ve y qué no.
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
import { MICRO_FOOD_SOURCES } from '@/utils/microRecommendations';
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

const SEX = 'female'; // ironRdaForSex('female') = 18

/** Agregado "suficiente": objetivo cubierto (pct=1) y confianza alta —
 * usado por defecto en los 5 micros que no son objeto de cada test, para
 * que sólo el nutriente bajo condicione la aserción. */
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
    value: rda * 0.2, // muy por debajo del objetivo
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

/** Todos los micros en estado "suficiente" salvo overrides puntuales. */
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

/** Async (mismo criterio que MicroTrendsScreen.paywallSource.test.tsx): el
 * `useFocusEffect` de DashboardScreen dispara `getWeekData(...).then(...)` —
 * sin esperar esa microtarea, Jest puede desmontar el entorno con la
 * promesa aún pendiente y volcar warnings de "act" ruidosos aunque el test
 * ya haya pasado. */
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
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — recomendación alimentaria bajo micronutrientes bajos (Dashboard accionable)', () => {
  it('un micro bajo con confianza alta muestra su recomendación específica; los demás (suficientes) no muestran ninguna', async () => {
    mockStores(micros({ iron_mg: lowValueAgg(RDAS.iron_mg, 0.9) })); // coverageByGrams 0.9 → 'high'
    const renderer = await renderDashboard();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain(MICRO_FOOD_SOURCES.iron_mg);
    // Ninguno de los otros 5 (todos "suficientes", pct=1) debería aparecer.
    for (const key of Object.keys(MICRO_FOOD_SOURCES) as (keyof typeof MICRO_FOOD_SOURCES)[]) {
      if (key === 'iron_mg') continue;
      expect(text).not.toContain(MICRO_FOOD_SOURCES[key]);
    }
  });

  it('un micro bajo con confianza "medium" también muestra su recomendación', async () => {
    mockStores(micros({ zinc_mg: lowValueAgg(RDAS.zinc_mg, 0.5) })); // coverageByGrams 0.5 → 'medium'
    const renderer = await renderDashboard();
    expect(JSON.stringify(renderer.toJSON())).toContain(MICRO_FOOD_SOURCES.zinc_mg);
  });

  it('un micro bajo con confianza "low" NO muestra recomendación', async () => {
    mockStores(micros({ calcium_mg: lowValueAgg(RDAS.calcium_mg, 0.2) })); // coverageByGrams 0.2 → 'low'
    const renderer = await renderDashboard();
    expect(JSON.stringify(renderer.toJSON())).not.toContain(MICRO_FOOD_SOURCES.calcium_mg);
  });

  it('un micro bajo pero sin ningún registro hoy (confidence "none") NO muestra recomendación', async () => {
    mockStores(
      micros({
        omega3_g: {
          value: 0,
          knownEntries: 0,
          totalEntries: 0,
          coverage: 0,
          knownGrams: 0,
          totalGrams: 0,
          coverageByGrams: 0,
          hasEntries: false, // día vacío para este nutriente → confidence 'none'
        },
      })
    );
    const renderer = await renderDashboard();
    expect(JSON.stringify(renderer.toJSON())).not.toContain(MICRO_FOOD_SOURCES.omega3_g);
  });

  it('un micro con el objetivo ya cubierto (pct >= 0.9) NO muestra recomendación aunque la confianza sea alta', async () => {
    mockStores(micros()); // todos en estado "suficiente" (pct=1, confidence 'high')
    const renderer = await renderDashboard();
    const text = JSON.stringify(renderer.toJSON());
    for (const source of Object.values(MICRO_FOOD_SOURCES)) {
      expect(text).not.toContain(source);
    }
  });
});
