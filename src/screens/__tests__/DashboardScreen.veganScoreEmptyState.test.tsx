/**
 * Auditoría de onboarding/primera sesión — el CTA "Ahora no, ir al resumen"
 * de `PostOnboardingWelcome` (y, en general, cualquier día sin ninguna
 * comida registrada) llevaba a un usuario nuevo directo a un Dashboard cuya
 * tarjeta de VeganScore ignoraba por completo `score.hasData`:
 * `computeVeganScore()` ya distingue "0 porque no hay ninguna comida hoy"
 * (`hasData: false`) de una puntuación real de 0, pero la pantalla siempre
 * pintaba el aro en el color de la puntuación (rojo "danger" para 0) con la
 * etiqueta del peor tramo ("Mejorable 🌱") y el desglose "0/30", "0/25"... —
 * exactamente el aspecto de un día fallido, no el de "todavía no has
 * registrado nada". Esto contradice el propio texto de bienvenida
 * ("Registra tu primera comida y verás al momento tus calorías...") y viola
 * la regla de no presentar una ausencia de datos como un mal resultado
 * (CLAUDE.md §7).
 *
 * Mismo arnés que `DashboardScreen.veganScoreMicrosClarification.test.tsx`.
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
import type { MicroAggregate } from '@/types';

/** Los 6 micronutrientes, cada uno como un día sin ningún registro
 * (`hasEntries: false`) — misma forma real que produce `summarizeEntries([])`
 * para un día vacío, nunca un objeto `{}` a medias (resolveMicroDisplay exige
 * un `MicroAggregate` completo por clave). */
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
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

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

function mockStores(daySummary: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; micros: Record<string, unknown> }) {
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
    selectedDate: '2026-09-25',
    fetchEntries: jest.fn().mockResolvedValue(undefined),
    getWeekData: jest.fn().mockResolvedValue([]),
    getVeganNutritionScoreTrend: jest.fn().mockResolvedValue([]),
    getDaySummary: () => daySummary,
  });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    getTodayContributions: () => ({}),
    getTodayContributionDetails: () => [],
  });
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
}

function allTexts(renderer: TestRenderer.ReactTestRenderer): unknown[] {
  return renderer.root.findAllByType(Text).map((t) => t.props.children);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardScreen — VeganScore sin ninguna comida registrada hoy no se muestra como un mal resultado', () => {
  it('sin ninguna comida hoy: "Sin datos aún" (nunca "Mejorable 🌱"), sin desglose 0/30 ni la aclaración de micros', async () => {
    mockStores({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, micros: emptyMicros() });
    const renderer = await renderDashboard();
    const texts = allTexts(renderer);

    expect(texts).toContain('Sin datos aún');
    expect(texts).toContain('Registra tu primera comida de hoy para ver tu VeganScore.');
    expect(texts.some((c) => typeof c === 'string' && c.includes('Mejorable'))).toBe(false);
    expect(texts.some((c) => typeof c === 'string' && c.includes('Micros clave: vitamina B12'))).toBe(false);
    // "Racha" es la etiqueta de una fila del desglose de VeganScore (a
    // diferencia de "Calorías"/"Proteína", no se repite en ninguna otra
    // tarjeta de la pantalla) — su ausencia confirma que el desglose
    // numérico ("0/30", "0/25"...) no se ha renderizado.
    expect(texts).not.toContain('Racha');
  });

  it('con comida registrada hoy: comportamiento sin cambios (etiqueta real de la puntuación y desglose numérico)', async () => {
    mockStores({ calories: 1500, protein_g: 60, carbs_g: 180, fat_g: 50, fiber_g: 20, micros: emptyMicros() });
    const renderer = await renderDashboard();
    const texts = allTexts(renderer);

    expect(texts).toContain('Racha');
    expect(texts.some((c) => typeof c === 'string' && c.includes('Micros clave: vitamina B12'))).toBe(true);
    expect(texts).not.toContain('Sin datos aún');
  });
});
