/**
 * Resumen como "día en curso" con un único siguiente paso.
 *
 * - Hero con el estado del día ("Hoy · aún sin registros" / "Hoy · en curso").
 * - Tarjeta "Siguiente paso" con UN solo botón primario, que reutiliza la
 *   navegación a Buscar con la franja actual (`mealTypeForHour`).
 * - VegeScore de hoy sin veredicto: número visible, "Hasta ahora", sin
 *   `getScoreLabel` ni color de `getScoreColor`. Fórmula intacta.
 * - `dashboard_viewed` una vez por visita real (foco), nunca por render;
 *   `next_step_tapped` una vez por pulsación. Sin datos nutricionales.
 *
 * El mock de `useFocusEffect` reproduce el ciclo real: el efecto se ejecuta
 * al montar (pantalla enfocada), cada vez que cambia su callback estando
 * enfocada, y en cada re-foco (`refocus()`); un simple re-render con las
 * mismas dependencias no lo vuelve a ejecutar.
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { Button, ProgressRing } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { usePro } from '@/hooks/usePro';
import { track } from '@/lib/analytics';
import { hasLoggedFood } from '@/lib/foodLoggingHistory';
import { VeganNutritionScoreTrend } from '@/components/VeganNutritionScoreTrend';
import { mealTypeForHour } from '@/utils/foodEntry';
import { MICRO_RDA, ironRdaForSex } from '@/utils/nutrition';
import { MICRO_FOOD_SOURCES } from '@/utils/microRecommendations';
import { getScoreColor, getScoreLabel } from '@/utils/veganScore';
import { addDays, todayISO } from '@/utils/dates';
import type { MicroAggregate } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: () => null,
  Polyline: () => null,
  Circle: () => null,
}));

const mockNavigate = jest.fn();
const mockFocusListeners = new Set<() => void>();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    const [focusGen, setFocusGen] = ReactActual.useState(0);
    ReactActual.useEffect(() => {
      const onFocus = () => setFocusGen((g: number) => g + 1);
      mockFocusListeners.add(onFocus);
      return () => {
        mockFocusListeners.delete(onFocus);
      };
    }, []);
    ReactActual.useEffect(() => cb(), [cb, focusGen]);
  },
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign(jest.fn(), { getState: jest.fn() }) }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: Object.assign(jest.fn(), { getState: jest.fn() }) }));
jest.mock('@/stores/supplementStore', () => ({ useSupplementStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/foodLoggingHistory', () => ({ hasLoggedFood: jest.fn() }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));
jest.mock('@/utils/foodEntry', () => ({
  ...jest.requireActual('@/utils/foodEntry'),
  mealTypeForHour: jest.fn(() => 'lunch'),
}));

const SEX = 'female';
const RDAS = {
  vitamin_b12_mcg: MICRO_RDA.vitamin_b12_mcg.rda,
  iron_mg: ironRdaForSex(SEX),
  zinc_mg: MICRO_RDA.zinc_mg.rda,
  calcium_mg: MICRO_RDA.calcium_mg.rda,
  vitamin_d_mcg: MICRO_RDA.vitamin_d_mcg.rda,
  omega3_g: MICRO_RDA.omega3_g.rda,
} as const;
type Key = keyof typeof RDAS;

function agg(value: number, hasEntries = true): MicroAggregate {
  return {
    value,
    knownEntries: hasEntries ? 1 : 0,
    totalEntries: hasEntries ? 1 : 0,
    coverage: hasEntries ? 1 : 0,
    knownGrams: hasEntries ? 100 : 0,
    totalGrams: hasEntries ? 100 : 0,
    coverageByGrams: hasEntries ? 0.9 : 0,
    hasEntries,
  };
}

/** Micros de un día: `ratio` de la RDA en todos (con confianza alta), o vacíos. */
function micros(ratio: number | null, overrides: Partial<Record<Key, MicroAggregate>> = {}) {
  const base = Object.fromEntries(
    (Object.keys(RDAS) as Key[]).map((k) => [k, ratio === null ? agg(0, false) : agg(RDAS[k] * ratio)])
  ) as Record<Key, MicroAggregate>;
  return { ...base, ...overrides };
}

interface Day {
  entries: { date: string; meal_type?: string }[];
  calories: number;
  protein_g: number;
  fiber_g?: number;
  micros?: ReturnType<typeof micros>;
}

const EMPTY_DAY: Day = { entries: [], calories: 0, protein_g: 0, micros: micros(null) };
const PARTIAL_DAY: Day = { entries: [{ date: todayISO() }], calories: 620.4, protein_g: 28.2, micros: micros(0.2) };
const GOAL_DAY: Day = { entries: [{ date: todayISO() }], calories: 2100, protein_g: 95, micros: micros(0.5) };
/** Un día "perfecto" según la fórmula (≈100/100): antes habría salido "Excelente 🌟" en verde. */
const PERFECT_DAY: Day = {
  entries: [{ date: todayISO() }],
  calories: 2000,
  protein_g: 110,
  fiber_g: 32,
  micros: micros(1.2),
};

let diaryState: Record<string, unknown>;
/** Historial de `getMicroTrends` (6 días previos + hoy, que el Dashboard descarta). */
let microHistory: unknown[] = [];
/** Patrón semanal de hierro: 4 de 6 días previos bajos. */
function ironPatternHistory() {
  const ok = { pct: 1, hasEntries: true, confidence: 'high' };
  const day = (ironPct: number) => ({
    date: '2026-09-01',
    micros: {
      vitamin_b12_mcg: ok, iron_mg: { pct: ironPct, hasEntries: true, confidence: 'high' },
      zinc_mg: ok, calcium_mg: ok, vitamin_d_mcg: ok, omega3_g: ok,
    },
  });
  return [0.2, 0.2, 0.2, 0.2, 1, 1, 1].map(day);
}
let authState: Record<string, unknown>;
let fetchEntries: jest.Mock;

function mockStores(day: Day, profileOverrides: Record<string, unknown> = {}, loggedBeforeHere = false) {
  (hasLoggedFood as jest.Mock).mockResolvedValue(loggedBeforeHere);
  fetchEntries = jest.fn().mockResolvedValue(undefined);
  diaryState = {
    selectedDate: todayISO(),
    entries: day.entries,
    setDate: jest.fn(),
    fetchEntries,
    getWeekData: jest.fn().mockResolvedValue([]),
    getVeganNutritionScoreTrend: jest.fn().mockResolvedValue([]),
    getMicroTrends: jest.fn().mockResolvedValue(microHistory),
    getDaySummary: () => ({
      calories: day.calories,
      protein_g: day.protein_g,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: day.fiber_g ?? 5,
      micros: day.micros ?? micros(null),
    }),
  };
  authState = {
    user: { id: 'user-1' },
    profile: {
      calorie_target: 2000,
      protein_target_g: 110,
      carbs_target_g: 250,
      fat_target_g: 70,
      streak_count: 3,
      last_log_date: addDays(todayISO(), -1),
      sex: SEX,
      ...profileOverrides,
    },
  };
  (useDiaryStore as unknown as jest.Mock).mockImplementation(() => diaryState);
  ((useDiaryStore as unknown as { getState: jest.Mock }).getState).mockImplementation(() => diaryState);
  (useAuthStore as unknown as jest.Mock).mockImplementation(() => authState);
  ((useAuthStore as unknown as { getState: jest.Mock }).getState).mockImplementation(() => authState);
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
    fetchTodayLogs: jest.fn().mockResolvedValue(undefined),
    getTodayContributions: () => ({}),
    getTodayContributionDetails: () => [],
  });
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
}

/** Cambia el día que devuelven los stores (p. ej. tras registrar en Buscar). */
function setDay(day: Day) {
  const prev = diaryState;
  diaryState = {
    ...prev,
    entries: day.entries,
    getDaySummary: () => ({
      calories: day.calories,
      protein_g: day.protein_g,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: day.fiber_g ?? 5,
      micros: day.micros ?? micros(null),
    }),
  };
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const tree = () => (
  <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
    <DashboardScreen />
  </SafeAreaProvider>
);

async function renderDashboard() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(tree());
  });
  return renderer;
}

async function refocus() {
  await act(async () => {
    mockFocusListeners.forEach((l) => l());
  });
}

function texts(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((n) => [].concat(n.props.children).join(''))
    .filter((s) => s.length > 0);
}

function trackCalls(event: string) {
  return (track as jest.Mock).mock.calls.filter(([e]) => e === event);
}

const ALL_SCORE_LABELS = [0, 41, 61, 81].map(getScoreLabel);
const ALL_SCORE_COLORS = new Set([0, 41, 61, 81].map(getScoreColor));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusListeners.clear();
  microHistory = [];
});

describe('Resumen de hoy — estado del día y siguiente paso', () => {
  it('empty + primer uso: "Tu día empieza aquí" con "Registrar primera comida"', async () => {
    mockStores(EMPTY_DAY, { last_log_date: null, streak_count: 0 });
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Hoy · aún sin registros');
    expect(t).toContain('Tu día empieza aquí');
    expect(t).toContain('Registra lo primero que comas y verás tu resumen.');
    expect(t).toContain('Registrar primera comida');
  });

  it('empty + usuario que vuelve: nombra la franja actual de `mealTypeForHour`', async () => {
    mockStores(EMPTY_DAY);
    const r = await renderDashboard();
    const t = texts(r);
    expect(mealTypeForHour).toHaveBeenCalledWith(new Date().getHours());
    expect(t).toContain('Hoy · aún sin registros');
    expect(t).toContain('Hoy aún no hay registros');
    expect(t).toContain('Añade tu comida para empezar el resumen.');
    expect(t).toContain('Registrar comida');
    expect(t).not.toContain('Tu día empieza aquí');
  });

  it('primer uso (C): historial borrado — `last_log_date` nulo pero la señal de producto dice que ya registró → nunca "primera vez"', async () => {
    mockStores(EMPTY_DAY, { last_log_date: null, streak_count: 0 }, true);
    const r = await renderDashboard();
    const t = texts(r);
    expect(hasLoggedFood).toHaveBeenCalledWith('user-1');
    expect(t).toContain('Hoy aún no hay registros');
    expect(t).not.toContain('Tu día empieza aquí');
    expect(t).not.toContain('Registrar primera comida');
  });

  it('el copy de primer uso no depende de la analítica: el Dashboard sólo expone `track`', async () => {
    const analytics = jest.requireMock('@/lib/analytics') as Record<string, unknown>;
    expect(Object.keys(analytics)).toEqual(['track']);
    mockStores(EMPTY_DAY, { last_log_date: null, streak_count: 0 }, true);
    const r = await renderDashboard();
    expect(texts(r)).not.toContain('Tu día empieza aquí');
  });

  it('primer uso (D): entradas de hoy pendientes de sincronizar (`last_log_date` aún nulo) → día en curso, sin "primera vez"', async () => {
    mockStores(PARTIAL_DAY, { last_log_date: null, streak_count: 0 });
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Siguiente paso');
    expect(t).not.toContain('Tu día empieza aquí');
  });

  it('primer uso (E): perfil sin cargar → no se asume primera vez', async () => {
    mockStores(EMPTY_DAY);
    authState = { ...authState, profile: null };
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Hoy aún no hay registros');
    expect(t).not.toContain('Tu día empieza aquí');
  });

  it('primer uso: mientras la señal de producto aún no se ha leído, no se asume primera vez', async () => {
    mockStores(EMPTY_DAY, { last_log_date: null, streak_count: 0 });
    (hasLoggedFood as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Hoy aún no hay registros');
    expect(t).not.toContain('Tu día empieza aquí');
  });

  it('in_progress con la franja actual vacía: lo registrado frente a los objetivos, con "Registrar comida"', async () => {
    mockStores(PARTIAL_DAY);
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Hoy · en curso');
    expect(t).toContain('Siguiente paso');
    expect(t).toContain('Llevas 620 de 2000 kcal · 28 de 110 g de proteína.');
    expect(t).toContain('Registrar comida');
    expect(t).not.toContain('Añadir a la comida');
  });

  it('in_progress con entradas de hoy en la franja actual: "Añadir a la comida"', async () => {
    mockStores({ ...PARTIAL_DAY, entries: [{ date: todayISO(), meal_type: 'lunch' }] });
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Añadir a la comida');
    expect(t).not.toContain('Registrar comida');
  });

  it('una entrada de la misma franja pero de otro día no cuenta: "Registrar comida"', async () => {
    mockStores({
      ...PARTIAL_DAY,
      entries: [{ date: todayISO(), meal_type: 'breakfast' }, { date: addDays(todayISO(), -1), meal_type: 'lunch' }],
    });
    const r = await renderDashboard();
    expect(texts(r)).toContain('Registrar comida');
  });

  it('in_progress + prioridad sin patrón: no aparece la fila (ni la tarjeta)', async () => {
    mockStores({ ...PARTIAL_DAY, micros: micros(1.2, { iron_mg: agg(RDAS.iron_mg * 0.2) }) });
    const t = texts(await renderDashboard());
    expect(t).not.toContain('Qué vigilar hoy');
    expect(t).not.toContain('Ver alimentos');
  });

  it('in_progress + prioridad con patrón: el patrón semanal, sin % de hoy, con alimentos y "Ver alimentos"', async () => {
    microHistory = ironPatternHistory();
    mockStores({ ...PARTIAL_DAY, micros: micros(1.2, { iron_mg: agg(RDAS.iron_mg * 0.2) }) });
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Qué vigilar hoy');
    expect(t.some((s) => s.includes('lo registrado quedó bajo en 5 de los últimos 7 días con datos'))).toBe(true);
    expect(t.some((s) => s.includes('% del objetivo'))).toBe(false);
    expect(t).toContain(MICRO_FOOD_SOURCES.iron_mg);
    expect(t).toContain('Ver alimentos');
    await act(async () => {
      let node = r.root.findAll((n) => n.props.children === 'Ver alimentos')[0];
      while (node && typeof node.props.onPress !== 'function') node = node.parent!;
      node.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Search', params: { nutrient: 'iron_mg' } });
  });

  it('in_progress: ninguna frase que valore el día en curso, haya o no patrón', async () => {
    for (const history of [[], ironPatternHistory()]) {
      microHistory = history;
      mockStores({
        ...PARTIAL_DAY,
        micros: micros(0.2), // los 6 micros bajos hoy, con confianza alta
      });
      const all = texts(await renderDashboard()).join(' | ').toLowerCase();
      expect(all).not.toContain('lo registrado hoy es bajo');
      expect(all).not.toMatch(/vas bajo|te falta|hoy es bajo/);
    }
  });

  it('in_progress con proteína desconocida: no aparece la proteína', async () => {
    mockStores({ ...PARTIAL_DAY, protein_g: 0 });
    const r = await renderDashboard();
    expect(texts(r)).toContain('Llevas 620 de 2000 kcal.');
  });

  it('goal_reached: invita a registrar lo que falte, sin recomendar alimentos', async () => {
    mockStores(GOAL_DAY);
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Hoy · en curso');
    expect(t).toContain(
      'Ya has alcanzado tu objetivo de calorías de hoy. Si te queda algo por registrar, puedes añadirlo.'
    );
    expect(t).toContain('Añadir algo más');
  });

  it.each([
    ['empty', EMPTY_DAY],
    ['in_progress', PARTIAL_DAY],
    ['goal_reached', GOAL_DAY],
  ])('%s: un único botón primario en toda la pantalla', async (_state, day) => {
    mockStores(day);
    const r = await renderDashboard();
    expect(r.root.findAllByType(Button)).toHaveLength(1);
  });

  it('el CTA navega a Buscar con la franja actual (misma ruta que el "＋" del Diario), sin `fromActivation`', async () => {
    mockStores(PARTIAL_DAY);
    const r = await renderDashboard();
    await act(async () => {
      r.root.findByType(Button).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Search', params: { mealType: 'lunch' } });
  });

  it('la tendencia recibe hoy como día en curso', async () => {
    mockStores(PARTIAL_DAY);
    const r = await renderDashboard();
    expect(r.root.findByType(VeganNutritionScoreTrend).props.inProgressDate).toBe(todayISO());
  });

  it('jerarquía: hero → Siguiente paso → VegeScore de hoy → Qué vigilar hoy → tendencia', async () => {
    microHistory = ironPatternHistory();
    mockStores({ ...PARTIAL_DAY, micros: micros(1.2, { iron_mg: agg(RDAS.iron_mg * 0.2) }) });
    const r = await renderDashboard();
    const t = texts(r);
    const order = ['Hoy · en curso', 'Siguiente paso', 'VegeScore de hoy', 'Qué vigilar hoy', 'VegeScore nutricional · 7 días'].map(
      (s) => t.indexOf(s)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('VegeScore de hoy — número visible, sin veredicto', () => {
  it.each([
    ['día casi vacío', PARTIAL_DAY],
    ['día "perfecto" según la fórmula', PERFECT_DAY],
  ])('%s: sin etiqueta de valoración ni color de valoración, con "Hasta ahora" y la nota', async (_name, day) => {
    mockStores(day);
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('VegeScore de hoy');
    expect(t).toContain('Hasta ahora');
    expect(t).toContain('Cambia a medida que registras. No es una valoración de tu día completo.');
    for (const label of ALL_SCORE_LABELS) expect(t.some((s) => s.includes(label))).toBe(false);

    const scoreRing = r.root.findAllByType(ProgressRing).find((n) => n.props.size === 80)!;
    expect(scoreRing).toBeDefined();
    expect(ALL_SCORE_COLORS.has(scoreRing.props.color)).toBe(false);
    // El número sigue visible (fórmula intacta: sólo cambia la presentación).
    expect(scoreRing.findAllByType(Text).some((n) => typeof n.props.children === 'number')).toBe(true);
  });

  it('el desglose sigue siendo puntos/máximo, sin las etiquetas por parte ("Lejos", "Muy bajo"…)', async () => {
    mockStores(PARTIAL_DAY);
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Racha');
    for (const partLabel of ['Lejos', 'Muy lejos', 'Muy bajo', 'Bajo', 'En rango ✓', 'Objetivo ✓']) {
      expect(t).not.toContain(partLabel);
    }
  });

  it('sin datos: forma compacta que sigue explicando qué es VegeScore, sin aro ni desglose', async () => {
    mockStores(EMPTY_DAY);
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Tu VegeScore aparecerá cuando registres tu primera comida.');
    expect(t).toContain('Resume de 0 a 100 tus calorías, proteína, micros clave, fibra y racha.');
    expect(r.root.findAllByType(ProgressRing).find((n) => n.props.size === 80)).toBeUndefined();
    expect(t).not.toContain('Hasta ahora');
  });

  it('no regresión de racha: la fila "Racha" usa la racha efectiva (ayer, 10 días → 10/10)', async () => {
    mockStores(PARTIAL_DAY, { streak_count: 10, last_log_date: addDays(todayISO(), -1) });
    const r = await renderDashboard();
    const label = r.root.findAllByType(Text).find((n) => n.props.children === 'Racha')!;
    expect([].concat(label.parent!.findAllByType(Text)[1].props.children).join('')).toBe('10/10');
  });

  it('no regresión de insight: "Qué vigilar hoy" sigue apareciendo con su acción secundaria (con patrón)', async () => {
    microHistory = ironPatternHistory();
    mockStores({ ...PARTIAL_DAY, micros: micros(1.2, { iron_mg: agg(RDAS.iron_mg * 0.2) }) });
    const r = await renderDashboard();
    const t = texts(r);
    expect(t).toContain('Qué vigilar hoy');
    expect(t).toContain('Ver alimentos');
  });
});

describe('Analítica del Resumen de hoy', () => {
  it('dashboard_viewed se emite una vez por visita, sólo con `state`', async () => {
    mockStores(PARTIAL_DAY);
    await renderDashboard();
    expect(trackCalls('dashboard_viewed')).toEqual([['dashboard_viewed', { state: 'in_progress' }]]);
  });

  it('no se duplica por re-renders ni por cambios de perfil estando ya en pantalla', async () => {
    mockStores(PARTIAL_DAY);
    const r = await renderDashboard();
    await act(async () => {
      r.update(tree());
      r.update(tree());
    });
    // Cambia el objetivo de kcal: el efecto de carga se vuelve a ejecutar
    // (nuevas dependencias), pero la visita ya estaba contada.
    authState = { ...authState, profile: { ...(authState.profile as object), calorie_target: 2200 } };
    await act(async () => {
      r.update(tree());
    });
    expect(fetchEntries.mock.calls.length).toBeGreaterThan(1);
    expect(trackCalls('dashboard_viewed')).toHaveLength(1);
  });

  it('cada re-foco es una visita nueva y refleja el estado de ese momento', async () => {
    mockStores(EMPTY_DAY);
    await renderDashboard();
    setDay(PARTIAL_DAY);
    await refocus();
    setDay(GOAL_DAY);
    await refocus();
    expect(trackCalls('dashboard_viewed').map(([, p]) => p)).toEqual([
      { state: 'empty' },
      { state: 'in_progress' },
      { state: 'goal_reached' },
    ]);
  });

  it('sin conexión (la carga remota falla) se sigue contando la visita con los datos locales', async () => {
    mockStores(PARTIAL_DAY);
    fetchEntries.mockRejectedValue(new Error('Network request failed'));
    await renderDashboard();
    expect(trackCalls('dashboard_viewed')).toEqual([['dashboard_viewed', { state: 'in_progress' }]]);
  });

  it('next_step_tapped: una vez por pulsación, con `state` y `meal_type` y nada más', async () => {
    mockStores(GOAL_DAY);
    const r = await renderDashboard();
    const button = r.root.findByType(Button);
    await act(async () => {
      button.props.onPress();
    });
    expect(trackCalls('next_step_tapped')).toEqual([
      ['next_step_tapped', { state: 'goal_reached', meal_type: 'lunch' }],
    ]);
    await act(async () => {
      r.update(tree());
    });
    expect(trackCalls('next_step_tapped')).toHaveLength(1);
    await act(async () => {
      r.root.findByType(Button).props.onPress();
    });
    expect(trackCalls('next_step_tapped')).toHaveLength(2);
  });
});
