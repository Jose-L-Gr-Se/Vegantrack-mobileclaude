/**
 * Tests de paridad: estos valores deben coincidir EXACTAMENTE con los que
 * calcula la PWA para el mismo perfil (Mifflin-St Jeor + multiplicadores).
 */
import { calculateTargets, calculateTDEE, getAge, scaleServing, summarizeEntries } from '@/utils/nutrition';
import type { FoodLogEntry } from '@/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

// Perfil de referencia: hombre, 80 kg, 180 cm, 30 años, moderado, mantener
const profile = {
  weight_kg: 80,
  height_cm: 180,
  birth_date: birthDateYearsAgo(30),
  sex: 'male' as const,
  activity_level: 'moderate' as const,
  goal: 'maintain' as const,
};

function birthDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 1); // ya cumplió este año
  return d.toISOString().split('T')[0];
}

describe('calculateTDEE', () => {
  it('aplica Mifflin-St Jeor con multiplicador de actividad', () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780 → TDEE = 1780 * 1.55 = 2759
    expect(calculateTDEE(profile)).toBe(2759);
  });

  it('resta 161 para mujeres', () => {
    // BMR = 10*60 + 6.25*165 - 5*30 - 161 = 1320.25 → ×1.2 = 1584.3 → 1584
    expect(
      calculateTDEE({ ...profile, weight_kg: 60, height_cm: 165, sex: 'female', activity_level: 'sedentary' })
    ).toBe(1584);
  });

  it('devuelve null si faltan datos', () => {
    expect(calculateTDEE({ ...profile, weight_kg: null })).toBeNull();
  });
});

describe('calculateTargets', () => {
  it('mantener: TDEE sin ajuste, proteína 1.8 g/kg, grasa 25% kcal', () => {
    const t = calculateTargets(profile)!;
    expect(t.calories).toBe(2759);
    expect(t.protein_g).toBe(144); // 80 * 1.8
    expect(t.fat_g).toBe(77); // 2759*0.25/9 = 76.6 → 77
    expect(t.carbs_g).toBe(373); // (2759 - 144*4 - 77*9)/4
  });

  it('cut resta 500 kcal y bulk suma 300', () => {
    expect(calculateTargets({ ...profile, goal: 'cut' })!.calories).toBe(2259);
    expect(calculateTargets({ ...profile, goal: 'bulk' })!.calories).toBe(3059);
  });
});

describe('getAge', () => {
  it('no cuenta el año si aún no ha cumplido', () => {
    expect(getAge('2000-12-31', new Date('2026-06-11'))).toBe(25);
    expect(getAge('2000-01-01', new Date('2026-06-11'))).toBe(26);
  });
});

describe('scaleServing', () => {
  it('escala por-100g a la ración con redondeo', () => {
    expect(scaleServing(8.9, 150)).toBe(13.4); // lentejas 150 g
  });
});

function makeEntry(over: Partial<FoodLogEntry>): FoodLogEntry {
  return {
    id: '1', user_id: 'u', date: '2026-06-11', meal_type: 'lunch',
    food_name: 'Test', barcode: null, brand: null, serving_size_g: 100,
    calories: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 3,
    sugar_g: 1, saturated_fat_g: 1, sodium_mg: 100,
    vitamin_b12_mcg: null, iron_mg: null, zinc_mg: null, calcium_mg: null,
    omega3_g: null, vitamin_d_mcg: null,
    vitamin_b12_known: false, iron_known: false, zinc_known: false,
    calcium_known: false, omega3_known: false, vitamin_d_known: false,
    source: 'openfoodfacts', source_ref: null, is_vegan: true,
    image_url: null, created_at: '', ...over,
  };
}

describe('summarizeEntries', () => {
  it('suma macros y calcula cobertura de micros', () => {
    const entries = [
      makeEntry({ iron_mg: 4, iron_known: true }),
      makeEntry({ calories: 200, protein_g: 15 }),
    ];
    const s = summarizeEntries(entries);
    expect(s.calories).toBe(300);
    expect(s.protein_g).toBe(25);
    expect(s.micros.iron_mg.value).toBe(4);
    expect(s.micros.iron_mg.knownEntries).toBe(1);
    expect(s.micros.iron_mg.totalEntries).toBe(2);
    expect(s.micros.iron_mg.coverage).toBe(0.5);
  });

  it('las entries manuales sin micro conocido no penalizan la cobertura', () => {
    const entries = [
      makeEntry({ iron_mg: 4, iron_known: true }),
      makeEntry({ source: 'manual' }),
    ];
    const s = summarizeEntries(entries);
    expect(s.micros.iron_mg.totalEntries).toBe(1);
    expect(s.micros.iron_mg.coverage).toBe(1);
  });

  it('aplica overrides a micros desconocidos', () => {
    const entries = [makeEntry({ food_name: 'tofu firme', serving_size_g: 200 })];
    const overrides = [
      {
        food_name_pattern: 'tofu',
        match_type: 'contains' as const,
        vitamin_b12_mcg_per_100g: null,
        iron_mg_per_100g: 2.7,
        zinc_mg_per_100g: null,
        calcium_mg_per_100g: 350,
        vitamin_d_mcg_per_100g: null,
        omega3_g_per_100g: null,
      },
    ];
    const s = summarizeEntries(entries, overrides);
    expect(s.micros.iron_mg.value).toBe(5.4); // 2.7 × 2
    expect(s.micros.calcium_mg.value).toBe(700);
    expect(s.micros.zinc_mg.knownEntries).toBe(0);
  });
});
