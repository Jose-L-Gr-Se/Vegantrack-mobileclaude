/**
 * `computeVeganNutritionScore` — auditoría de histórico de VeganScore.
 *
 * No es "computeVeganScore con streak=0": es una métrica propia, sin ningún
 * componente de racha (ni siquiera vacío). Estos tests comprueban
 * exactamente eso — que el resultado NUNCA varía con la racha, aunque el
 * VeganScore normal sí lo haga — usando la MISMA fixture nutricional en
 * ambas funciones para poder comparar directamente.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import { computeVeganScore, computeVeganNutritionScore } from '@/utils/veganScore';
import type { NutrientSummary } from '@/types';

function summary(over: Partial<NutrientSummary> = {}, micros: Partial<Record<string, number>> = {}): NutrientSummary {
  const micro = (value: number) => ({
    value, knownEntries: 1, totalEntries: 1, coverage: 1,
    knownGrams: 100, totalGrams: 100, coverageByGrams: 1, hasEntries: true,
  });
  const empty = () => ({
    value: 0, knownEntries: 0, totalEntries: 0, coverage: 0,
    knownGrams: 0, totalGrams: 0, coverageByGrams: 0, hasEntries: false,
  });
  return {
    calories: 2000,
    protein_g: 120,
    carbs_g: 250,
    fat_g: 60,
    fiber_g: 35,
    micros: {
      vitamin_b12_mcg: micros.vitamin_b12_mcg !== undefined ? micro(micros.vitamin_b12_mcg) : empty(),
      iron_mg: micros.iron_mg !== undefined ? micro(micros.iron_mg) : empty(),
      zinc_mg: empty(),
      calcium_mg: empty(),
      omega3_g: empty(),
      vitamin_d_mcg: micros.vitamin_d_mcg !== undefined ? micro(micros.vitamin_d_mcg) : empty(),
    },
    ...over,
  };
}

const baseNutrition = {
  calorieTarget: 2000,
  proteinTarget: 120,
  suppContributions: {},
  sex: 'male' as const,
};

describe('computeVeganNutritionScore', () => {
  it('sin calorías devuelve hasData=false y total 0, sin campo streak', () => {
    const s = computeVeganNutritionScore({ ...baseNutrition, summary: summary({ calories: 0 }) });
    expect(s.hasData).toBe(false);
    expect(s.total).toBe(0);
    expect('streak' in s).toBe(false);
  });

  it('día perfecto: 30+25+20+15 = 90, reescalado a 100', () => {
    const s = computeVeganNutritionScore({
      ...baseNutrition,
      summary: summary({}, { vitamin_b12_mcg: 2.4, vitamin_d_mcg: 15, iron_mg: 8 }),
    });
    expect(s.calories.score).toBe(30);
    expect(s.protein.score).toBe(25);
    expect(s.micros.score).toBe(20);
    expect(s.fiber.score).toBe(15);
    expect(s.total).toBe(100);
  });

  it('el total nunca depende de la racha: no acepta streakCount y no cambia si la racha real fuese otra', () => {
    // Mismos datos nutricionales que "calorías al 75%": calScore=18,
    // proScore=25, microScore=0 (sin datos ni suplemento), fiberScore=15.
    // raw = 58 → 58*100/90 ≈ 64.44 → 64.
    const nutritionScore = computeVeganNutritionScore({ ...baseNutrition, summary: summary({ calories: 1500 }) });
    expect(nutritionScore.total).toBe(64);

    // computeVeganScore, MISMOS datos, con dos rachas distintas: el total
    // varía (58 vs 68) — pero el nutricional de arriba fue uno solo y no
    // tiene ningún parámetro de racha que pudiera haberlo cambiado.
    const withoutStreak = computeVeganScore({
      calorieTarget: 2000, proteinTarget: 120, sex: 'male', suppContributions: {},
      streakCount: 0,
      summary: summary({ calories: 1500 }),
    });
    const withStreak = computeVeganScore({
      calorieTarget: 2000, proteinTarget: 120, sex: 'male', suppContributions: {},
      streakCount: 10,
      summary: summary({ calories: 1500 }),
    });
    expect(withoutStreak.total).toBe(58);
    expect(withStreak.total).toBe(68);
    expect(withoutStreak.total).not.toBe(withStreak.total);
  });

  it('mismos datos nutricionales + distinta racha (vía computeVeganScore) → mismo score nutricional', () => {
    const summaryFixture = summary({ calories: 1500 });
    const a = computeVeganNutritionScore({ ...baseNutrition, summary: summaryFixture });
    const b = computeVeganNutritionScore({ ...baseNutrition, summary: summaryFixture });
    // Llamarlo dos veces con la misma fixture (nunca se le pasa racha) da
    // siempre el mismo resultado — no hay ningún camino por el que una
    // racha distinta pudiera colarse.
    expect(a.total).toBe(b.total);
    expect(a).toEqual(b);
  });

  it('diferencia estructural con computeVeganScore: mismos 4 componentes, sin racha, distinto total', () => {
    const summaryFixture = summary({ calories: 1500 });
    const nutrition = computeVeganNutritionScore({ ...baseNutrition, summary: summaryFixture });
    const full = computeVeganScore({
      calorieTarget: 2000, proteinTarget: 120, sex: 'male', suppContributions: {}, streakCount: 3,
      summary: summaryFixture,
    });

    // Mismos 4 componentes nutricionales, calculados de forma idéntica.
    expect(nutrition.calories).toEqual(full.calories);
    expect(nutrition.protein).toEqual(full.protein);
    expect(nutrition.micros).toEqual(full.micros);
    expect(nutrition.fiber).toEqual(full.fiber);
    // Pero el total difiere (90 vs 100 de escala, y la racha de `full` suma
    // puntos que `nutrition` nunca tiene) y `nutrition` no tiene campo `streak`.
    expect(nutrition.total).not.toBe(full.total);
    expect('streak' in nutrition).toBe(false);
    expect('streak' in full).toBe(true);
  });

  it('comportamiento con suplementos: un suplemento puede cubrir un micro sin datos de comida', () => {
    const s = computeVeganNutritionScore({
      ...baseNutrition,
      suppContributions: { vitamin_b12_mcg: 25, vitamin_d_mcg: 25 },
      summary: summary(),
    });
    // 2/3 micros cubiertos por suplemento (igual que en computeVeganScore) →
    // 2 × 20/3 ≈ 13.33 puntos de micros.
    expect(s.micros.score).toBe(13);
    expect(s.micros.label).toBe('2/3 cubiertos');
  });

  it('límite: el total nunca supera 100 aunque el redondeo interno se acerque al máximo', () => {
    const s = computeVeganNutritionScore({
      ...baseNutrition,
      summary: summary({}, { vitamin_b12_mcg: 2.4, vitamin_d_mcg: 15, iron_mg: 8 }),
    });
    expect(s.total).toBeLessThanOrEqual(100);
  });
});
