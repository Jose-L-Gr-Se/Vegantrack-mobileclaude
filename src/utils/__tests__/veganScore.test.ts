/** Paridad del VeganScore con la PWA: mismos umbrales, mismos puntos. */
import { computeVeganScore, getScoreColor, getScoreLabel } from '@/utils/veganScore';
import type { NutrientSummary } from '@/types';

function summary(over: Partial<NutrientSummary> = {}, micros: Partial<Record<string, number>> = {}): NutrientSummary {
  const micro = (value: number) => ({ value, knownEntries: 1, totalEntries: 1, coverage: 1 });
  const empty = () => ({ value: 0, knownEntries: 0, totalEntries: 0, coverage: 0 });
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

  it('cobertura < 50% ignora el valor de comida', () => {
    const s: NutrientSummary = summary();
    s.micros.iron_mg = { value: 20, knownEntries: 1, totalEntries: 4, coverage: 0.25 };
    const result = computeVeganScore({ ...base, summary: s });
    // hierro no cuenta pese a value=20
    expect(result.micros.label).toBe('0/3 cubiertos');
  });
});

describe('score color/label', () => {
  it.each([
    [85, '#16a34a', 'Excelente 🌟'],
    [70, '#f59e0b', 'Bien 👍'],
    [50, '#f97316', 'En progreso 💪'],
    [20, '#ef4444', 'Mejorable 🌱'],
  ])('score %i', (score, color, label) => {
    expect(getScoreColor(score)).toBe(color);
    expect(getScoreLabel(score)).toBe(label);
  });
});
