/**
 * Primer Nutrition Insight — reglas de decisión de `nutritionInsight.ts`.
 * Pura: sin React, sin stores. Mismo mock de dependencias que
 * `microRecommendations.test.ts` (`nutrition.ts` carga `@/lib/nutrientOverrides`
 * → `@/db/database`, expo-sqlite).
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import {
  buildNutritionInsight,
  describeInsightPriority,
  insightsForDayInProgress,
  type HistoricalMicroDay,
  type NutritionInsightPriority,
} from '@/utils/nutritionInsight';
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

/** `iron_mg` bajo y con dato fiable — para construir días previos "válidos y bajos". */
function lowValidDay() {
  return historyDay({ iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' } });
}

/** `iron_mg` con el objetivo cubierto y dato fiable — día "válido y no bajo". */
function goodValidDay() {
  return historyDay({ iron_mg: { pct: 1, hasEntries: true, confidence: 'high' } });
}

/** `iron_mg` sin ningún registro relevante ese día — día "inválido" por falta de dato. */
function noDataDay() {
  return historyDay({ iron_mg: { pct: 0, hasEntries: false, confidence: 'none' } });
}

/** `iron_mg` con registros pero confianza por debajo del mínimo — también "inválido". */
function lowConfidenceDay() {
  return historyDay({ iron_mg: { pct: 0.05, hasEntries: true, confidence: 'low' } });
}

const TODAY_IRON_LOW = todayAllSufficient({ iron_mg: display({ pct: 0.3, confidence: 'high' }) });

describe('buildNutritionInsight — "hoy" vs "patrón" (ventana de 7 días, evidencia por ratio)', () => {
  it('1. 5 de 7 días válidos bajos (incluido hoy) → "pattern"', () => {
    // Hoy (1 válido+bajo) + 6 previos: 4 bajos + 2 cubiertos → 5/7 válidos bajos (≥70%).
    const previousDays = [lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay(), goodValidDay(), goodValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0]).toMatchObject({ key: 'iron_mg', urgency: 'pattern', lowDays: 5, validDays: 7 });
  });

  it('2. 3 de 4 días válidos bajos (incluido hoy) → "pattern"', () => {
    // Hoy (1 válido+bajo) + 3 previos: 2 bajos + 1 cubierto → 3/4 válidos bajos (≥70%).
    const previousDays = [lowValidDay(), lowValidDay(), goodValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0]).toMatchObject({ key: 'iron_mg', urgency: 'pattern', lowDays: 3, validDays: 4 });
  });

  it('3. 2 de 4 días válidos bajos (incluido hoy) → NO "pattern" (no llega al 70%)', () => {
    // Hoy (1 válido+bajo) + 3 previos: 1 bajo + 2 cubiertos → 2/4 = 50% < 70%.
    const previousDays = [lowValidDay(), goodValidDay(), goodValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0].urgency).toBe('today');
    expect(result[0].lowDays).toBeUndefined();
    expect(result[0].validDays).toBeUndefined();
  });

  it('4. 3 de 7 días válidos bajos (incluido hoy) → NO "pattern" (no llega al 70%)', () => {
    // Hoy (1 válido+bajo) + 6 previos: 2 bajos + 4 cubiertos → 3/7 ≈ 43% < 70%.
    const previousDays = [lowValidDay(), lowValidDay(), goodValidDay(), goodValidDay(), goodValidDay(), goodValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0].urgency).toBe('today');
  });

  it('5. menos de 4 días válidos en la ventana → NO "pattern", aunque todos los válidos estén bajos', () => {
    // Hoy (1 válido+bajo) + 2 previos válidos y bajos + 4 sin dato → sólo 3 válidos en total (< MIN_VALID_DAYS=4).
    const previousDays = [lowValidDay(), lowValidDay(), noDataDay(), noDataDay(), noDataDay(), noDataDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0].urgency).toBe('today');
  });

  it('6. un día sin datos en mitad de la ventana no cuenta ni a favor ni en contra', () => {
    // 5 previos válidos y bajos con un día sin datos INTERCALADO en medio — el
    // día vacío desaparece del recuento entero: quedan 6 válidos (no 7) y 6
    // bajos (no un 5/7 ni un 5/6 con el vacío contando como "no bajo").
    const previousDays = [lowValidDay(), lowValidDay(), noDataDay(), lowValidDay(), lowValidDay(), lowValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0]).toMatchObject({ urgency: 'pattern', lowDays: 6, validDays: 6 });
  });

  it('7. un día con confianza baja no cuenta ni a favor ni en contra, aunque su pct sea muy bajo', () => {
    // 3 previos válidos y bajos + 1 con confianza 'low' (pct=0.05, el más bajo
    // de todos) — si contara, serían 5 válidos y 5 bajos; al excluirse, se
    // quedan en 4 válidos y 4 bajos.
    const previousDays = [lowValidDay(), lowValidDay(), lowValidDay(), lowConfidenceDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0]).toMatchObject({ urgency: 'pattern', lowDays: 4, validDays: 4 });
  });

  it('8. hoy no bajo → el micro no aparece, aunque el histórico por sí solo sería un patrón', () => {
    const todayIronOk = todayAllSufficient({ iron_mg: display({ pct: 1, confidence: 'high' }) });
    const previousDays = [lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay()];
    const result = buildNutritionInsight(todayIronOk, previousDays);
    expect(result.find((p) => p.key === 'iron_mg')).toBeUndefined();
  });

  it('9. patrón con hoy bajo aparece exponiendo lowDays/validDays con el denominador real', () => {
    const previousDays = [lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay(), lowValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0]).toMatchObject({ key: 'iron_mg', urgency: 'pattern', lowDays: 7, validDays: 7 });
  });

  it('sin histórico (usuario nuevo, previousDays=[]) siempre es "today" — nunca inventa un patrón', () => {
    expect(buildNutritionInsight(TODAY_IRON_LOW, [])[0].urgency).toBe('today');
    expect(buildNutritionInsight(TODAY_IRON_LOW)[0].urgency).toBe('today'); // parámetro por defecto
  });

  it('la regla anterior (3 días consecutivos, los 3 estrictos) YA NO basta por sí sola', () => {
    // Exactamente el disparador de la regla del bloque 1: hoy + 2 días
    // anteriores, los 3 válidos y bajos. Antes esto era "pattern"
    // (PATTERN_LOOKBACK_DAYS=2, los 2 cumplían `.every()`); ahora sólo suma
    // 3 días válidos en total, por debajo de MIN_VALID_DAYS=4 — se queda en
    // "today", sin importar que los 3 estuvieran bajos.
    const previousDays = [lowValidDay(), lowValidDay()];
    const result = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(result[0].urgency).toBe('today');
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
      historyDay({
        iron_mg: { pct: 0.2, hasEntries: true, confidence: 'high' },
        zinc_mg: { pct: 1, hasEntries: true, confidence: 'high' },
      }),
    ];
    const result = buildNutritionInsight(today, previousDays);
    const byKey = Object.fromEntries(result.map((p) => [p.key, p.urgency]));
    expect(byKey.iron_mg).toBe('pattern'); // 4/4 válidos bajos
    expect(byKey.zinc_mg).toBe('today'); // 0/4 válidos bajos
  });
});

describe('describeInsightPriority — el copy describe lo REGISTRADO, con el denominador real', () => {
  const base: NutritionInsightPriority = { key: 'iron_mg', label: 'Hierro', pct: 0.32, urgency: 'today', reason: 'x' };

  it('"hoy": observación del registro de hoy, con el % del objetivo', () => {
    expect(describeInsightPriority(base)).toBe('lo registrado hoy es bajo · 32 % del objetivo');
  });

  it('patrón con 7 días válidos: "5 de los últimos 7 días con datos"', () => {
    const p = { ...base, urgency: 'pattern' as const, lowDays: 5, validDays: 7 };
    expect(describeInsightPriority(p)).toBe(
      'lo registrado quedó bajo en 5 de los últimos 7 días con datos · 32 % del objetivo hoy'
    );
  });

  it('patrón con 4 días válidos: el denominador es 4, NUNCA 7', () => {
    const p = { ...base, urgency: 'pattern' as const, lowDays: 3, validDays: 4 };
    const text = describeInsightPriority(p);
    expect(text).toBe('lo registrado quedó bajo en 3 de los últimos 4 días con datos · 32 % del objetivo hoy');
    expect(text).not.toContain('7');
  });

  it('el denominador sale de `validDays` del motor, no del tamaño de la ventana (integración con buildNutritionInsight)', () => {
    // Hoy + 3 previos válidos (2 bajos, 1 cubierto) + 3 días sin datos → 3 de 4, no "de 7".
    const previousDays = [lowValidDay(), lowValidDay(), goodValidDay(), noDataDay(), noDataDay(), noDataDay()];
    const [p] = buildNutritionInsight(TODAY_IRON_LOW, previousDays);
    expect(describeInsightPriority(p)).toContain('3 de los últimos 4 días con datos');
  });

  it('día en curso: "hoy" sin el % del objetivo de hoy', () => {
    expect(describeInsightPriority(base, { dayInProgress: true })).toBe('lo registrado hoy es bajo');
  });

  it('día en curso: el patrón semanal se mantiene, sin el % de hoy', () => {
    const p: NutritionInsightPriority = { ...base, urgency: 'pattern', lowDays: 5, validDays: 7 };
    expect(describeInsightPriority(p, { dayInProgress: true })).toBe(
      'lo registrado quedó bajo en 5 de los últimos 7 días con datos'
    );
  });

  it('sin la opción (días cerrados) el texto no cambia', () => {
    expect(describeInsightPriority(base, {})).toBe(describeInsightPriority(base));
    expect(describeInsightPriority(base, { dayInProgress: false })).toBe('lo registrado hoy es bajo · 32 % del objetivo');
  });

  it('nunca usa lenguaje de déficit, carencia ni diagnóstico, ni afirma nada sobre la ingesta real', () => {
    const variants: NutritionInsightPriority[] = [
      base,
      { ...base, urgency: 'pattern', lowDays: 5, validDays: 7 },
      { ...base, urgency: 'pattern', lowDays: 3, validDays: 4 },
    ];
    for (const p of variants) {
      const text = describeInsightPriority(p).toLowerCase();
      expect(text).not.toMatch(/d[eé]ficit|carencia|deficien|riesgo|enferm|diagn[oó]st/);
      expect(text).toContain('registrado');
    }
  });

  it('un patrón sin lowDays/validDays (no debería ocurrir) degrada a la frase de "hoy", nunca a "undefined"', () => {
    const text = describeInsightPriority({ ...base, urgency: 'pattern' });
    expect(text).toBe('lo registrado hoy es bajo · 32 % del objetivo');
    expect(text).not.toContain('undefined');
  });
});

describe('insightsForDayInProgress — el Resumen de hoy sólo muestra patrones semanales', () => {
  const today: NutritionInsightPriority = { key: 'zinc_mg', label: 'Zinc', pct: 0.4, urgency: 'today', reason: 'z' };
  const pattern: NutritionInsightPriority = {
    key: 'iron_mg', label: 'Hierro', pct: 0.3, urgency: 'pattern', reason: 'i', lowDays: 5, validDays: 7,
  };

  it('descarta las prioridades sólo de hoy y conserva las de patrón, en su orden', () => {
    expect(insightsForDayInProgress([pattern, today])).toEqual([pattern]);
    expect(insightsForDayInProgress([today])).toEqual([]);
  });

  it('una prioridad "pattern" sin evidencia (lowDays/validDays) no se muestra', () => {
    expect(insightsForDayInProgress([{ ...pattern, lowDays: undefined, validDays: undefined }])).toEqual([]);
  });

  it('días pasados: buildNutritionInsight y el copy por defecto no cambian (incluyen "hoy" y su %)', () => {
    expect(describeInsightPriority(today)).toBe('lo registrado hoy es bajo · 40 % del objetivo');
    expect(describeInsightPriority(pattern)).toBe(
      'lo registrado quedó bajo en 5 de los últimos 7 días con datos · 30 % del objetivo hoy'
    );
  });
});
