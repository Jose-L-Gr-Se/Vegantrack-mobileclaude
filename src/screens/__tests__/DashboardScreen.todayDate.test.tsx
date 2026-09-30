/**
 * Auditoría del VeganScore — el Dashboard no tiene selector de fecha propio:
 * todo lo que muestra ("Macros de hoy", el VeganScore, el gráfico semanal)
 * asume "hoy" sin más. Pero `entries`/`getDaySummary()`/`getWeekData()` de
 * `diaryStore` leen `selectedDate`, un estado COMPARTIDO con el Diario —
 * si el usuario navegaba el Diario a un día pasado (con las flechas ‹/›) y
 * después abría el Dashboard sin volver antes a hoy, estas tarjetas
 * mostraban en silencio los datos de ESE día pasado bajo el rótulo "hoy",
 * sin ningún indicador de que no lo era.
 *
 * Esto contradice directamente el histórico de VeganScore nutricional que
 * la propia pantalla muestra más abajo (`getVeganNutritionScoreTrend`), que
 * SIEMPRE ancla su último punto en `todayISO()` real — así que el VeganScore
 * "de hoy" (arriba) podía no coincidir con el punto "de hoy" del histórico
 * (abajo), exactamente por usar fuentes de fecha distintas para lo mismo.
 *
 * Reproducción: `selectedDate` queda en un día pasado (p. ej. porque el
 * Diario se dejó así) y se abre el Dashboard — debe forzar la fecha
 * seleccionada a hoy y pedir las entradas de hoy, no las del día viejo.
 *
 * Mismo arnés que `DashboardScreen.veganScoreEmptyState.test.tsx`.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { usePro } from '@/hooks/usePro';
import { todayISO } from '@/utils/dates';
import type { MicroAggregate } from '@/types';

/** Los 6 micronutrientes, cada uno como un día sin ningún registro — misma
 *  forma real que produce `summarizeEntries([])` (ver
 *  DashboardScreen.veganScoreEmptyState.test.tsx). */
function emptyMicros(): Record<string, MicroAggregate> {
  const keys = ['vitamin_b12_mcg', 'iron_mg', 'zinc_mg', 'calcium_mg', 'vitamin_d_mcg', 'omega3_g'];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      { value: 0, knownEntries: 0, totalEntries: 0, coverage: 0, knownGrams: 0, totalGrams: 0, coverageByGrams: 0, hasEntries: false },
    ])
  );
}

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
jest.mock('@/lib/foodLoggingHistory', () => ({ hasLoggedFood: () => Promise.resolve(false) }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const STALE_DATE = '2026-09-20'; // día pasado en el que se quedó el Diario

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
  const setDate = jest.fn();
  const fetchEntries = jest.fn().mockResolvedValue(undefined);
  const getWeekData = jest.fn().mockResolvedValue([]);
  const getVeganNutritionScoreTrend = jest.fn().mockResolvedValue([]);
  const getMicroTrends = jest.fn().mockResolvedValue([]);

  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    user: { id: 'user-1' },
    profile: {
      calorie_target: 2000,
      protein_target_g: 100,
      carbs_target_g: 250,
      fat_target_g: 70,
      streak_count: 0,
      sex: 'female',
    },
  });
  (useDiaryStore as unknown as jest.Mock).mockReturnValue({
    selectedDate: STALE_DATE,
    // Una entrada con fecha de hoy: el Resumen está "en curso".
    entries: [{ date: todayISO() }],
    setDate,
    fetchEntries,
    getWeekData,
    getVeganNutritionScoreTrend,
    getMicroTrends,
    getDaySummary: () => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, micros: emptyMicros() }),
  });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    getTodayContributions: () => ({}),
    getTodayContributionDetails: () => [],
  });
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });

  return { setDate, fetchEntries, getWeekData, getVeganNutritionScoreTrend, getMicroTrends };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — siempre debe mostrar HOY, aunque el Diario se haya dejado en otro día (auditoría del VeganScore)', () => {
  it('con selectedDate en un día pasado, al abrir el Dashboard fuerza la fecha a hoy y pide las entradas de hoy', async () => {
    const { setDate, fetchEntries, getWeekData } = mockStores();

    await renderDashboard();

    // El Dashboard no puede confiar en `selectedDate` tal cual la dejó el
    // Diario: todo lo que muestra asume "hoy", así que debe forzarla.
    expect(setDate).toHaveBeenCalledWith(todayISO());
    // Y pedir explícitamente las entradas de HOY, no las del día viejo en el
    // que se había quedado `selectedDate` antes de este fix.
    expect(fetchEntries).toHaveBeenCalledWith('user-1', todayISO());
    expect(fetchEntries).not.toHaveBeenCalledWith('user-1', STALE_DATE);
    expect(getWeekData).toHaveBeenCalledWith('user-1');
  });
});
