/**
 * Fase 2 del P0 de micronutrientes — consistencia entre consumidores.
 *
 * Dashboard, VeganScore y las tendencias de micros deben tomar EXACTAMENTE
 * la misma decisión semántica (known, pct, confidence) para el mismo
 * `MicroAggregate` + aporte de suplemento + RDA, porque los tres llaman a
 * `resolveMicroDisplay` en vez de reimplementar su propio umbral — la causa
 * raíz del bug original (docs/NUTRICION-MICRONUTRIENTES.md). Este test no
 * repite la cobertura exhaustiva de `resolveMicroDisplay` (eso vive en
 * nutrition.test.ts, Fase 1): documenta la invariante cross-consumidor.
 */
// nutrition.ts carga '@/lib/nutrientOverrides' → '@/db/database' (expo-sqlite):
// mismo mock que nutrition.test.ts, para no ejecutar SQLite real en tests.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import { resolveMicroDisplay, MIN_SCORE_CONFIDENCE, meetsMinConfidence } from '@/utils/nutrition';
import { computeVeganScore } from '@/utils/veganScore';
import type { MicroAggregate, NutrientSummary } from '@/types';

function emptyAgg(): MicroAggregate {
  return {
    value: 0, knownEntries: 0, totalEntries: 0, coverage: 0,
    knownGrams: 0, totalGrams: 0, coverageByGrams: 0, hasEntries: false,
  };
}

describe('el mismo MicroAggregate produce la misma decisión en Dashboard, VeganScore y Tendencias', () => {
  it('B12 al 100% de la RDA con confianza media: mismo pct/known/confidence en las tres vías', () => {
    const agg: MicroAggregate = {
      value: 2.4, knownEntries: 1, totalEntries: 2, coverage: 0.5,
      knownGrams: 150, totalGrams: 300, coverageByGrams: 0.5, hasEntries: true,
    };
    const rda = 2.4;
    const suppAmount = 0;

    // Vía "Dashboard" y vía "Tendencias": ambas llaman a resolveMicroDisplay
    // directamente con el mismo agregado — deben ser idénticas.
    const dashboardDisplay = resolveMicroDisplay(agg, suppAmount, rda);
    const trendsDisplay = resolveMicroDisplay(agg, suppAmount, rda);
    expect(trendsDisplay).toEqual(dashboardDisplay);
    expect(dashboardDisplay.known).toBe(2.4);
    expect(dashboardDisplay.pct).toBeCloseTo(1, 10);
    expect(dashboardDisplay.confidence).toBe('medium');
    expect(meetsMinConfidence(dashboardDisplay.confidence, MIN_SCORE_CONFIDENCE)).toBe(true);

    // Vía "VeganScore": mismo agregado, incrustado en un NutrientSummary
    // completo. El crédito completo de B12 debe activarse porque
    // ratio=pct=1 (>=0.9) y confidence='medium' alcanza MIN_SCORE_CONFIDENCE.
    const summary: NutrientSummary = {
      calories: 2000, protein_g: 100, carbs_g: 200, fat_g: 60, fiber_g: 30,
      micros: {
        vitamin_b12_mcg: agg,
        iron_mg: emptyAgg(),
        zinc_mg: emptyAgg(),
        calcium_mg: emptyAgg(),
        omega3_g: emptyAgg(),
        vitamin_d_mcg: emptyAgg(),
      },
    };
    const score = computeVeganScore({
      summary, calorieTarget: 2000, proteinTarget: 100, streakCount: 0,
      suppContributions: {}, sex: 'male',
    });
    expect(score.micros.label).toBe('1/3 cubiertos');
  });

  it('el suplemento se suma aparte y nunca se mezcla dentro del MicroAggregate de comida', () => {
    const agg: MicroAggregate = {
      value: 5, knownEntries: 1, totalEntries: 1, coverage: 1,
      knownGrams: 100, totalGrams: 100, coverageByGrams: 1, hasEntries: true,
    };
    const suppAmount = 3;
    const display = resolveMicroDisplay(agg, suppAmount, 10);

    // El agregado de comida no se toca: knownFood == agg.value siempre.
    expect(display.knownFood).toBe(agg.value);
    expect(agg.value).toBe(5); // el objeto de entrada no se muta
    expect(display.supplement).toBe(3);
    expect(display.known).toBe(8);
    // La confianza describe SÓLO el dato de comida — el suplemento (100%
    // conocido por definición) nunca la altera.
    expect(display.confidence).toBe('high');
  });
});
