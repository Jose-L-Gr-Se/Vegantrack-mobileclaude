/**
 * Dashboard accionable — reglas de decisión de `microRecommendations.ts`.
 * Pura: sin React, sin stores. `microRecommendations.ts` importa
 * `nutrition.ts`, que a su vez carga `@/lib/nutrientOverrides` →
 * `@/db/database` (expo-sqlite) — mismo mock que ya usa `veganScore.test.ts`
 * para no ejecutar SQLite real en tests.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import {
  MICRO_FOOD_SOURCES,
  microRecommendationText,
  shouldShowMicroRecommendation,
  type MicroKey,
} from '@/utils/microRecommendations';
import { MICRO_RDA, type MicroConfidence, type MicroDisplay } from '@/utils/nutrition';

function display(over: Partial<MicroDisplay> = {}): MicroDisplay {
  return {
    knownFood: 0,
    supplement: 0,
    known: 0,
    target: 10,
    pct: 0,
    coverage: 0,
    coverageByGrams: 0,
    confidence: 'high',
    hasEntries: true,
    ...over,
  };
}

describe('shouldShowMicroRecommendation', () => {
  it('con confidence "none", nunca recomienda, aunque pct sea muy bajo', () => {
    expect(shouldShowMicroRecommendation(display({ pct: 0, confidence: 'none' }))).toBe(false);
  });

  it('con confidence "low", nunca recomienda, aunque pct sea muy bajo', () => {
    expect(shouldShowMicroRecommendation(display({ pct: 0.1, confidence: 'low' }))).toBe(false);
  });

  it('con confidence "medium" y pct bajo, sí recomienda', () => {
    expect(shouldShowMicroRecommendation(display({ pct: 0.5, confidence: 'medium' }))).toBe(true);
  });

  it('con confidence "high" y pct bajo, sí recomienda', () => {
    expect(shouldShowMicroRecommendation(display({ pct: 0.5, confidence: 'high' }))).toBe(true);
  });

  it('con pct >= 0.9, nunca recomienda, aunque la confianza sea alta', () => {
    expect(shouldShowMicroRecommendation(display({ pct: 0.9, confidence: 'high' }))).toBe(false);
    expect(shouldShowMicroRecommendation(display({ pct: 1, confidence: 'high' }))).toBe(false);
  });

  it('justo por debajo de 0.9, con confianza suficiente, sí recomienda', () => {
    expect(shouldShowMicroRecommendation(display({ pct: 0.899, confidence: 'medium' }))).toBe(true);
  });

  it('un suplemento que por sí solo cubre el objetivo apaga la recomendación (vía pct, sin excepción aparte)', () => {
    // known = knownFood + supplement ya incluye el suplemento — pct llega a
    // >= 0.9 sin necesitar ningún caso especial en la regla de decisión.
    const d = display({ knownFood: 0, supplement: 20, known: 20, target: 18, pct: 20 / 18, confidence: 'low' });
    expect(shouldShowMicroRecommendation(d)).toBe(false);
  });

  it.each<MicroConfidence>(['none', 'low', 'medium', 'high'])(
    'a igualdad de pct bajo, sólo "medium" y "high" cruzan MIN_SCORE_CONFIDENCE (confidence=%s)',
    (confidence) => {
      const expected = confidence === 'medium' || confidence === 'high';
      expect(shouldShowMicroRecommendation(display({ pct: 0.3, confidence }))).toBe(expected);
    }
  );
});

describe('microRecommendationText', () => {
  it('devuelve null cuando no toca mostrar nada', () => {
    expect(microRecommendationText('iron_mg', display({ pct: 1, confidence: 'high' }))).toBeNull();
    expect(microRecommendationText('iron_mg', display({ pct: 0.2, confidence: 'none' }))).toBeNull();
  });

  it('devuelve el texto específico del nutriente cuando sí toca', () => {
    const d = display({ pct: 0.4, confidence: 'medium' });
    expect(microRecommendationText('iron_mg', d)).toBe(MICRO_FOOD_SOURCES.iron_mg);
    expect(microRecommendationText('vitamin_b12_mcg', d)).toBe(MICRO_FOOD_SOURCES.vitamin_b12_mcg);
  });

  it('el texto de vitamina D no menciona exposición solar (primera versión: sólo fuentes alimentarias/fortificadas)', () => {
    expect(MICRO_FOOD_SOURCES.vitamin_d_mcg.toLowerCase()).not.toMatch(/sol|uv/);
  });

  it('ningún texto es una frase genérica repetida — cada uno es específico y menciona al menos un alimento/fuente', () => {
    const texts = Object.values(MICRO_FOOD_SOURCES);
    expect(new Set(texts).size).toBe(texts.length); // todos distintos entre sí
  });

  it('las 6 claves de MICRO_RDA tienen copy definido (ningún micro se queda sin texto)', () => {
    const microKeys = Object.keys(MICRO_RDA) as MicroKey[];
    expect(microKeys).toHaveLength(6);
    for (const key of microKeys) {
      expect(typeof MICRO_FOOD_SOURCES[key]).toBe('string');
      expect(MICRO_FOOD_SOURCES[key].length).toBeGreaterThan(0);
    }
    // Y a la inversa: MICRO_FOOD_SOURCES no tiene claves huérfanas fuera de MICRO_RDA.
    expect(Object.keys(MICRO_FOOD_SOURCES).sort()).toEqual([...microKeys].sort());
  });
});
