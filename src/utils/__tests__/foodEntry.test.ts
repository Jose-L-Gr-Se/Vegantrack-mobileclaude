/** Integración: producto OFF → ración → entry → resumen del día. */
import { buildEntry } from '@/utils/foodEntry';
import { summarizeEntries } from '@/utils/nutrition';
import { normalizeProduct, productToFoodPer100g } from '@/lib/openfoodfacts';
import type { FoodLogEntry } from '@/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({
  kvGet: jest.fn(),
  kvSet: jest.fn(),
  getCachedOffProduct: jest.fn().mockResolvedValue(null),
  cacheOffProduct: jest.fn().mockResolvedValue(undefined),
}));

const lentejas = productToFoodPer100g(
  normalizeProduct({
    code: '111',
    product_name: 'Lentejas cocidas',
    brands: 'Bio',
    labels_tags: ['en:vegan'],
    nutriments: {
      'energy-kcal_100g': 116,
      proteins_100g: 9,
      carbohydrates_100g: 20,
      fat_100g: 0.4,
      fiber_100g: 7.9,
      iron_100g: 0.0033, // 3.3 mg
    },
  })
);

describe('buildEntry', () => {
  it('escala una ración de 150 g con los redondeos de la PWA', () => {
    const e = buildEntry(lentejas, 150, 'lunch', '2026-06-11', 'user-1');
    expect(e.calories).toBe(174); // 116 × 1.5
    expect(e.protein_g).toBe(13.5);
    expect(e.fiber_g).toBe(11.9); // 7.9 × 1.5 = 11.85 → 11.9
    expect(e.iron_mg).toBeCloseTo(4.95, 1); // 3.3 × 1.5, redondeado a 1 decimal
    expect(e.iron_known).toBe(true);
    expect(e.vitamin_b12_known).toBe(false);
    expect(e.meal_type).toBe('lunch');
    expect(e.is_vegan).toBe(true);
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('dos ids generados nunca coinciden', () => {
    const a = buildEntry(lentejas, 100, 'dinner', '2026-06-11', 'u');
    const b = buildEntry(lentejas, 100, 'dinner', '2026-06-11', 'u');
    expect(a.id).not.toBe(b.id);
  });
});

describe('flujo entry → resumen', () => {
  it('el resumen del día refleja las raciones añadidas', () => {
    const now = new Date().toISOString();
    const entries: FoodLogEntry[] = [
      { ...buildEntry(lentejas, 200, 'lunch', '2026-06-11', 'u'), created_at: now },
      { ...buildEntry(lentejas, 100, 'dinner', '2026-06-11', 'u'), created_at: now },
    ];
    const s = summarizeEntries(entries);
    expect(s.calories).toBe(348); // 232 + 116
    expect(s.protein_g).toBe(27);
    expect(s.micros.iron_mg.coverage).toBe(1);
    expect(s.micros.iron_mg.value).toBeCloseTo(9.9); // 6.6 + 3.3
  });

  it('P0 plausibilidad: un hierro impossible (14 g/100g → 14.000 mg) no llega a summarizeEntries/VeganScore/tendencias', () => {
    // Mismo caso histórico de la auditoría, de punta a punta: producto OFF
    // con la unidad de hierro equivocada → buildEntry() → summarizeEntries().
    // Ni summarizeEntries ni veganScore.ts se han tocado para esto: el
    // guard vive en buildEntry, así que el 14.000 nunca llega a food_log.
    const contaminado = productToFoodPer100g(
      normalizeProduct({
        code: '999',
        product_name: 'Producto con dato erróneo',
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2, iron_100g: 14 },
      })
    );
    expect(contaminado.iron_mg).toBe(14000); // FoodPer100g conserva el valor crudo, sin corregirlo

    const now = new Date().toISOString();
    const entry = { ...buildEntry(contaminado, 100, 'lunch', '2026-06-11', 'u'), created_at: now };

    // El guard actúa exactamente como "OFF no lo reportó": null + known=false,
    // nunca 0 — el mismo mecanismo que ya usa el resto del motor nutricional.
    expect(entry.iron_mg).toBeNull();
    expect(entry.iron_known).toBe(false);

    const s = summarizeEntries([entry]);
    expect(s.micros.iron_mg.coverage).toBe(0);
    expect(s.micros.iron_mg.value).toBe(0);
    expect(s.micros.iron_mg.knownEntries).toBe(0);

    // El resto de macros de esa misma entry, no afectadas por el guard de
    // hierro, se guardan con total normalidad — el fix es quirúrgico.
    expect(entry.calories).toBe(100);
    expect(entry.protein_g).toBe(5);
  });
});
