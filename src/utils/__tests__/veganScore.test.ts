/** Paridad del VeganScore con la PWA: mismos umbrales, mismos puntos. */
import { computeVeganScore, getScoreColor, getScoreLabel } from '@/utils/veganScore';
import type { NutrientSummary } from '@/types';

function summary(over: Partial<NutrientSummary> = {}, micros: Partial<Record<string, number>> = {}): NutrientSummary {
  // Fase 1 del P0 de micronutrientes amplió MicroAggregate de forma aditiva
  // (docs/NUTRICION-MICRONUTRIENTES.md): estos fixtures rellenan los campos
  // nuevos con valores coherentes (1 entrada conocida ≈ 100 g) sólo para
  // cumplir el tipo. veganScore.ts todavía no los lee — no hay cambio de
  // comportamiento aquí.
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

const base = {
  calorieTarget: 2000,
  proteinTarget: 120,
  streakCount: 0,
  suppContributions: {},
  sex: 'male' as const,
};

describe('computeVeganScore', () => {
  it('sin calorías devuelve hasData=false y total 0', () => {
    const s = computeVeganScore({ ...base, summary: summary({ calories: 0 }) });
    expect(s.hasData).toBe(false);
    expect(s.total).toBe(0);
  });

  it('día perfecto: 30+25+20+15+10 = 100', () => {
    const s = computeVeganScore({
      ...base,
      streakCount: 7,
      summary: summary({}, { vitamin_b12_mcg: 2.4, vitamin_d_mcg: 15, iron_mg: 8 }),
    });
    expect(s.calories.score).toBe(30);
    expect(s.protein.score).toBe(25);
    expect(s.micros.score).toBe(20);
    expect(s.fiber.score).toBe(15);
    expect(s.streak.score).toBe(10);
    expect(s.total).toBe(100);
  });

  it('calorías al 75% del objetivo dan 18 pts ("Cerca")', () => {
    const s = computeVeganScore({ ...base, summary: summary({ calories: 1500 }) });
    expect(s.calories.score).toBe(18);
    expect(s.calories.label).toBe('Cerca');
  });

  it('los suplementos cubren micros sin datos de comida', () => {
    const s = computeVeganScore({
      ...base,
      suppContributions: { vitamin_b12_mcg: 25, vitamin_d_mcg: 25 },
      summary: summary(),
    });
    // 2 de 3 micros cubiertos al 100% → 2 × 6.67 ≈ 13
    expect(s.micros.score).toBe(13);
    expect(s.micros.label).toBe('2/3 cubiertos');
  });

  it('RDA de hierro depende del sexo (8 ♂ / 18 ♀)', () => {
    const withIron = summary({}, { iron_mg: 9 });
    const male = computeVeganScore({ ...base, summary: withIron });
    const female = computeVeganScore({ ...base, sex: 'female', summary: withIron });
    // 9/8 ≥ 0.9 cubre en hombre; 9/18 = 0.5 da medio punto en mujer
    expect(male.micros.score).toBeGreaterThan(female.micros.score);
  });

  it('cobertura < 50% ignora el valor de comida (comportamiento actual de veganScore.ts, sin cambios en Fase 1)', () => {
    // Documenta el bug conocido (docs/NUTRICION-MICRONUTRIENTES.md): la Fase 1
    // sólo construye el núcleo de datos (MicroAggregate, summarizeEntries,
    // resolveMicroDisplay); veganScore.ts se conecta en una fase posterior.
    // Cuando eso ocurra, este test deberá actualizarse para reflejar que
    // value=20 SÍ debe contar (con confianza baja), no descartarse a 0.
    const s: NutrientSummary = summary();
    s.micros.iron_mg = {
      value: 20, knownEntries: 1, totalEntries: 4, coverage: 0.25,
      knownGrams: 100, totalGrams: 400, coverageByGrams: 0.25, hasEntries: true,
    };
    const result = computeVeganScore({ ...base, summary: s });
    // hierro no cuenta pese a value=20 — bug pendiente de Fase 2, no de esta.
    expect(result.micros.label).toBe('0/3 cubiertos');
  });
});

describe('score color/label', () => {
  it.each([
    [85, '#2f5d41', 'Excelente 🌟'],
    [70, '#c98a2b', 'Bien 👍'],
    [50, '#cc7a3b', 'En progreso 💪'],
    [20, '#c0473e', 'Mejorable 🌱'],
  ])('score %i', (score, color, label) => {
    expect(getScoreColor(score)).toBe(color);
    expect(getScoreLabel(score)).toBe(label);
  });
});
