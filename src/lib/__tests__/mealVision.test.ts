/** Mapeo de la estimación de IA al formato común por-100g. */
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
  WEB_BASE_URL: 'https://example.test',
}));

import { analysisToFood, type MealAnalysis } from '@/lib/mealVision';

const analysis: MealAnalysis = {
  is_food: true,
  food_name: 'Bowl de garbanzos y aguacate',
  estimated_grams: 350,
  per_100g: {
    calories: 180,
    protein_g: 7.2,
    carbs_g: 20.1,
    fat_g: 8.4,
    fiber_g: 5.5,
    sugar_g: 2.1,
    saturated_fat_g: 1.2,
  },
  is_vegan: true,
  vegan_confidence: 'high',
  non_vegan_ingredients: [],
};

describe('analysisToFood', () => {
  it('copia los macros por-100g y marca el origen como ai_photo', () => {
    const f = analysisToFood(analysis);
    expect(f.source).toBe('ai_photo');
    expect(f.food_name).toBe('Bowl de garbanzos y aguacate');
    expect(f.calories).toBe(180);
    expect(f.protein_g).toBe(7.2);
    expect(f.is_vegan).toBe(true);
  });

  it('deja los micros como desconocidos (la IA no los estima de forma fiable)', () => {
    const f = analysisToFood(analysis);
    expect(f.vitamin_b12_mcg).toBeNull();
    expect(f.iron_mg).toBeNull();
    expect(f.vitamin_b12_known).toBe(false);
    expect(f.iron_known).toBe(false);
    expect(f.calcium_known).toBe(false);
  });

  it('mapea un plato NO vegano sin bloquearlo (análisis general para todos)', () => {
    const nonVegan: MealAnalysis = {
      ...analysis,
      food_name: 'Pollo con arroz',
      is_vegan: false,
      vegan_confidence: 'low',
      non_vegan_ingredients: ['pollo'],
    };
    const f = analysisToFood(nonVegan);
    expect(f.is_vegan).toBe(false);
    expect(f.food_name).toBe('Pollo con arroz');
    // Sigue siendo un alimento válido y guardable (macros presentes).
    expect(f.calories).toBeGreaterThan(0);
    expect(f.source).toBe('ai_photo');
  });
});
