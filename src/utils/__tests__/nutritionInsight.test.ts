/**
 * Primer Nutrition Insight — reglas de decisión de `nutritionInsight.ts`.
 * Pura: sin React, sin stores. Mismo mock de dependencias que
 * `microRecommendations.test.ts` (`nutrition.ts` carga `@/lib/nutrientOverrides`
 * → `@/db/database`, expo-sqlite).
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import { buildNutritionInsight, type HistoricalMicroDay } from '@/utils/nutritionInsight';
import { MICRO_FOOD_SOURCES } from '@/utils/microRecommendations';
import { MICRO_RDA, type MicroConfidence, type MicroDisplay } from '@/utils/nutrition';
import type { MicroKey } from '@/stores/diaryStore';

function display(over: Partial<MicroDisplay> = {}): MicroDisplay {
  return {
    knownFood: 0,
    supplement: 0,
    known: 0,
    target: 10,
    pct: 1,
    coverage: 1,
    coverageByGrams: 1,
    confidence: 'high',
    hasEntries: true,
    ...over,
  };
}

/** Los 6 micros en estado "suficiente" (pct=1, confianza alta) salvo overrides puntuales. */
function todayAllSufficient(overrides: Partial<Record<MicroKey, MicroDisplay>> = {}): Record<MicroKey, MicroDisplay> {
  const base = Object.fromEntries((Object.keys(MICRO_RDA) as MicroKey[]).map((k) => [k, display()])) as Record<
    MicroKey,
    MicroDisplay
  >;
  return { ...base, ...overrides };
}

function historyDay(overrides: Partial<Record<MicroKey, { pct: number; hasEntries: boolean; confidence: MicroConfidence }>> = {}): HistoricalMicroDay {
  const base = Object.fromEntries(
    (Object.keys(MICRO_RDA) as MicroKey[]).map((k) => [k, { pct: 1, hasEntries: true, confidence: 'high' as MicroConfidence }])
  ) as HistoricalMicroDay['micros'];
  return { micros: { ...base, ...overrides } };
}

describe('buildNutritionInsight — sin datos suficientes, no propone nada', () => {
  it('sin comida registrada hoy (los 6 en confidence "none"), devuelve una lista vacía', () => {
    const today = todayAllSufficient(
      Object.fromEntries(
        (Object.keys(MICRO_RDA) as MicroKey[]).map((k) => [k, display({ pct: 0, confidence: 'none', hasEntries: false })])
      ) as Partial<Record<MicroKey, MicroDisplay>>
    );
    expect(buildNutritionInsight(today)).toEqual([]);
  });

  it('con los 6 micros ya cubiertos (pct >= 0.9), devuelve una lista vacía — nada que vigilar', () => {
    expect(buildNutritionInsight(todayAllSufficient())).toEqual([]);
  });

  it('un micro bajo pero con confianza insuficiente (low) no se propone', () => {
    const today = todayAllSufficient({ calcium_mg: display({ pct: 0.2, confidence: 'low' }) });
    expect(buildNutritionInsight(today)).toEqual([]);
  });
});

describe('buildNutritionInsight — selección y orden de prioridades', () => {
  it('un único micro bajo con confianza suficiente aparece como única prioridad, "hoy"', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'medium' }) });
    const result = buildNutritionInsight(today);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: 'iron_mg', urgency: 'today', reason: MICRO_FOOD_SOURCES.iron_mg });
  });

  it('varios micros bajos se ordenan de menor a mayor pct (el más lejos del objetivo, primero)', () => {
    const today = todayAllSufficient({
      calcium_mg: display({ pct: 0.7, confidence: 'high' }),
      iron_mg: display({ pct: 0.1, confidence: 'high' }),
      zinc_mg: display({ pct: 0.4, confidence: 'high' }),
    });
    const result = buildNutritionInsight(today);
    expect(result.map((p) => p.key)).toEqual(['iron_mg', 'zinc_mg', 'calcium_mg']);
  });

  it('nunca devuelve más de 3 prioridades, aunque más de 3 micros estén bajos', () => {
    const today = todayAllSufficient({
      vitamin_b12_mcg: display({ pct: 0.1, confidence: 'high' }),
      iron_mg: display({ pct: 0.2, confidence: 'high' }),
      zinc_mg: display({ pct: 0.3, confidence: 'high' }),
      calcium_mg: display({ pct: 0.4, confidence: 'high' }),
      vitamin_d_mcg: display({ pct: 0.5, confidence: 'high' }),
    });
    const result = buildNutritionInsight(today);
    expect(result).toHaveLength(3);
    // Los 3 más bajos, en ese orden — nunca los últimos ni una selección arbitraria.
    expect(result.map((p) => p.key)).toEqual(['vitamin_b12_mcg', 'iron_mg', 'zinc_mg']);
  });

  it('un suplemento que por sí solo cubre el objetivo apaga la prioridad, igual que en microRecommendations', () => {
    const today = todayAllSufficient({
      vitamin_b12_mcg: display({ knownFood: 0, supplement: 20, known: 20, target: 18, pct: 20 / 18, confidence: 'low' }),
    });
    expect(buildNutritionInsight(today)).toEqual([]);
  });
});

describe('buildNutritionInsight — "hoy" vs "patrón", sin inventar histórico', () => {
  it('bajo hoy y en los 2 días anteriores (con dato fiable) → "pattern"', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });
    const previousDays = [
      historyDay({ iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' } }),
      historyDay({ iron_mg: { pct: 0.4, hasEntries: true, confidence: 'medium' } }),
    ];
    const result = buildNutritionInsight(today, previousDays);
    expect(result[0].urgency).toBe('pattern');
  });

  it('bajo hoy pero bien en algún día anterior → "today", no "pattern"', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });
    const previousDays = [
      historyDay({ iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' } }),
      historyDay({ iron_mg: { pct: 0.95, hasEntries: true, confidence: 'high' } }), // ese día SÍ llegó al objetivo
    ];
    expect(buildNutritionInsight(today, previousDays)[0].urgency).toBe('today');
  });

  it('sin histórico (usuario nuevo, previousDays=[]) siempre es "today" — nunca inventa un patrón', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });
    expect(buildNutritionInsight(today, [])[0].urgency).toBe('today');
    expect(buildNutritionInsight(today)[0].urgency).toBe('today'); // parámetro por defecto
  });

  it('un día anterior sin registros para ese micro (hasEntries=false) nunca cuenta como "bajo" — no hay pattern', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });
    const previousDays = [
      historyDay({ iron_mg: { pct: 0, hasEntries: false, confidence: 'none' } }),
      historyDay({ iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' } }),
    ];
    expect(buildNutritionInsight(today, previousDays)[0].urgency).toBe('today');
  });

  it('un día anterior con confianza baja (low) tampoco cuenta como parte del patrón, aunque el pct sea bajo', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });
    const previousDays = [
      historyDay({ iron_mg: { pct: 0.1, hasEntries: true, confidence: 'low' } }),
      historyDay({ iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' } }),
    ];
    expect(buildNutritionInsight(today, previousDays)[0].urgency).toBe('today');
  });

  it('con sólo 1 día de histórico (todavía no llegan los 2 exigidos) nunca es "pattern"', () => {
    const today = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });
    const previousDays = [historyDay({ iron_mg: { pct: 0.1, hasEntries: true, confidence: 'high' } })];
    expect(buildNutritionInsight(today, previousDays)[0].urgency).toBe('today');
  });

  it('la urgencia se decide por micro, de forma independiente — uno puede ser "pattern" y otro "today" a la vez', () => {
    const today = todayAllSufficient({
      iron_mg: display({ pct: 0.2, confidence: 'high' }), // patrón
      zinc_mg: display({ pct: 0.3, confidence: 'high' }), // sólo hoy
    });
    const previousDays = [
      historyDay({
        iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' },
        zinc_mg: { pct: 1, hasEntries: true, confidence: 'high' },
      }),
      historyDay({
        iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' },
        zinc_mg: { pct: 1, hasEntries: true, confidence: 'high' },
      }),
    ];
    const result = buildNutritionInsight(today, previousDays);
    const byKey = Object.fromEntries(result.map((p) => [p.key, p.urgency]));
    expect(byKey.iron_mg).toBe('pattern');
    expect(byKey.zinc_mg).toBe('today');
  });
});
