/** Paridad del VeganScore con la PWA: mismos umbrales, mismos puntos. */
// Fase 2 del P0 de micronutrientes: veganScore.ts ahora importa
// resolveMicroDisplay de '@/utils/nutrition', que a su vez carga
// '@/lib/nutrientOverrides' → '@/db/database' (expo-sqlite). Mismo mock que
// ya usa nutrition.test.ts — no se ejecuta SQLite real en tests.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

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

  it('cobertura baja YA NO descarta el valor de comida a 0 (Fase 2 conectada)', () => {
    // Antes (bug documentado en docs/NUTRICION-MICRONUTRIENTES.md): value=20
    // con coverage=0.25 se descartaba a 0 → 0 pts. Ahora: value=20 sí cuenta
    // (hierro ♂ RDA=8 → ratio=2.5, sobra para el 90%), pero coverageByGrams
    // = 0.25 da confidence='low' (< MIN_SCORE_CONFIDENCE='medium'), así que
    // sólo se otorga medio crédito, nunca 0 pts por un valor conocido real.
    const s: NutrientSummary = summary();
    s.micros.iron_mg = {
      value: 20, knownEntries: 1, totalEntries: 4, coverage: 0.25,
      knownGrams: 100, totalGrams: 400, coverageByGrams: 0.25, hasEntries: true,
    };
    const result = computeVeganScore({ ...base, summary: s });
    // Ya no es "0/3 cubiertos": hay medio crédito de hierro (no cuenta como
    // "cubierto" porque el crédito completo exige confianza media).
    expect(result.micros.label).toBe('0/3 cubiertos');
    expect(result.micros.score).toBeGreaterThan(0);
  });

  describe('Fase 2 — MIN_SCORE_CONFIDENCE y crédito completo', () => {
    // Helper: fija sólo el agregado de hierro (♂, RDA=8) del resto de la fixture.
    function withIron(agg: NutrientSummary['micros']['iron_mg']): NutrientSummary {
      const s = summary();
      s.micros.iron_mg = agg;
      return s;
    }

    it('1. cobertura baja + ratio alto → NO crédito completo (no "cubierto")', () => {
      const s = withIron({
        value: 20, knownEntries: 1, totalEntries: 5, coverage: 0.2,
        knownGrams: 80, totalGrams: 400, coverageByGrams: 0.2, hasEntries: true,
      });
      const result = computeVeganScore({ ...base, summary: s });
      // ratio = 20/8 = 2.5 (≥0.9), pero confidence='low' → no cuenta como cubierto.
      expect(result.micros.label).toBe('0/3 cubiertos');
    });

    it('2. cobertura media + ratio alto → SÍ crédito completo (medium alcanza el mínimo)', () => {
      const s = withIron({
        value: 20, knownEntries: 1, totalEntries: 2, coverage: 0.5,
        knownGrams: 200, totalGrams: 400, coverageByGrams: 0.5, hasEntries: true,
      });
      const result = computeVeganScore({ ...base, summary: s });
      // coverageByGrams=0.5 → confidence='medium' === MIN_SCORE_CONFIDENCE → cubre.
      expect(result.micros.label).toBe('1/3 cubiertos');
    });

    it('3. cobertura alta + ratio alto → crédito completo', () => {
      const s = withIron({
        value: 20, knownEntries: 1, totalEntries: 1, coverage: 1,
        knownGrams: 400, totalGrams: 400, coverageByGrams: 1, hasEntries: true,
      });
      const result = computeVeganScore({ ...base, summary: s });
      expect(result.micros.label).toBe('1/3 cubiertos');
    });

    it('4. cobertura baja de comida, pero el suplemento por sí solo cubre el objetivo → crédito completo', () => {
      const s = withIron({
        value: 0, knownEntries: 0, totalEntries: 3, coverage: 0,
        knownGrams: 0, totalGrams: 300, coverageByGrams: 0, hasEntries: true,
      });
      const result = computeVeganScore({
        ...base,
        suppContributions: { iron_mg: 8 }, // = RDA masculino
        summary: s,
      });
      // confidence='low' (coverageByGrams=0), pero fromSupp(8) >= rda(8):
      // la baja cobertura de comida no debe bloquear el crédito.
      expect(result.micros.label).toBe('1/3 cubiertos');
    });

    it('5. día vacío (sin registros) no se trata como un cero de comida "conocido"', () => {
      const s = withIron({
        value: 0, knownEntries: 0, totalEntries: 0, coverage: 0,
        knownGrams: 0, totalGrams: 0, coverageByGrams: 0, hasEntries: false,
      });
      const result = computeVeganScore({ ...base, summary: s });
      // hasEntries=false → confidence='none', que no alcanza MIN_SCORE_CONFIDENCE
      // ni por asomo (ratio=0 de por sí no llega a 0.9 tampoco): no cubierto,
      // pero tampoco debe romperse ni tratarse como si "confirmase" 0 mg.
      expect(result.micros.label).toBe('0/3 cubiertos');
      expect(Number.isFinite(result.micros.score)).toBe(true);
    });
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
