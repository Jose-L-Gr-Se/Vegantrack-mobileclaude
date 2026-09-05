/**
 * P0 de plausibilidad nutricional de OpenFoodFacts.
 *
 * Los fixtures pasan por normalizeProduct + productToFoodPer100g (la misma
 * cadena real de conversión de unidades), no objetos FoodPer100g escritos a
 * mano — así los casos ×1000 se reproducen exactamente como en producción,
 * no como una aproximación.
 */
import { normalizeProduct, productToFoodPer100g } from '@/lib/openfoodfacts';
import { isSafeToPersist, validateProductNutrition } from '@/utils/productNutritionValidation';
import type { FoodPer100g } from '@/types';

jest.mock('@/db/database', () => ({
  getCachedOffProduct: jest.fn().mockResolvedValue(null),
  cacheOffProduct: jest.fn().mockResolvedValue(undefined),
}));

function food(nutriments: Record<string, unknown>, extra: Record<string, unknown> = {}): FoodPer100g {
  return productToFoodPer100g(
    normalizeProduct({ code: 'x', product_name: 'Producto de prueba', nutriments, ...extra })
  );
}

describe('validateProductNutrition — casos base', () => {
  it('valor normal (lentejas reales) → valid en todos los campos', () => {
    const f = food({
      'energy-kcal_100g': 116,
      proteins_100g: 9,
      carbohydrates_100g: 20,
      fat_100g: 0.4,
      fiber_100g: 7.9,
      sugars_100g: 1.6,
      'saturated-fat_100g': 0.1,
      sodium_100g: 0.24,
      iron_100g: 0.0033, // 3.3 mg — dato real
    });
    const r = validateProductNutrition(f);
    expect(r.overall).toBe('clean');
    expect(r.fields.iron_mg).toEqual({ status: 'valid' });
    expect(r.fields.calories).toEqual({ status: 'valid' });
  });

  it('campo ausente → unknown (nunca 0, nunca valid)', () => {
    const f = food({ 'energy-kcal_100g': 100, proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2 });
    // sin iron_100g en absoluto
    const r = validateProductNutrition(f);
    expect(f.iron_mg).toBeNull();
    expect(f.iron_known).toBe(false);
    expect(r.fields.iron_mg).toEqual({ status: 'unknown' });
  });

  it('valor 0 explícito → valid (0 no es lo mismo que ausente)', () => {
    const f = food({
      'energy-kcal_100g': 0, // agua
      proteins_100g: 0,
      carbohydrates_100g: 0,
      fat_100g: 0,
      iron_100g: 0,
    });
    const r = validateProductNutrition(f);
    expect(f.iron_known).toBe(true); // OFF SÍ reportó el campo, con valor 0
    expect(r.fields.iron_mg).toEqual({ status: 'valid' });
    expect(r.fields.calories).toEqual({ status: 'valid' });
  });

  it('valor negativo en cualquier campo → impossible', () => {
    const f = food({ 'energy-kcal_100g': 100, proteins_100g: -5, carbohydrates_100g: 10, fat_100g: 2 });
    const r = validateProductNutrition(f);
    expect(r.fields.protein_g.status).toBe('impossible');
    expect(r.fields.protein_g.reason).toBe('negative_value');
    expect(r.overall).toBe('has_impossible');
  });
});

describe('validateProductNutrition — composición de macros (B)', () => {
  it('protein 40 + carbs 40 + fat 40 (=120) → impossible en los tres', () => {
    const f = food({ 'energy-kcal_100g': 400, proteins_100g: 40, carbohydrates_100g: 40, fat_100g: 40 });
    const r = validateProductNutrition(f);
    expect(r.fields.protein_g.status).toBe('impossible');
    expect(r.fields.carbs_g.status).toBe('impossible');
    expect(r.fields.fat_g.status).toBe('impossible');
    expect(r.fields.protein_g.reason).toBe('macro_sum_exceeds_100g');
  });

  it('suma ligeramente superior a 100 g por redondeo (105 g, dentro del margen) → NO falso positivo', () => {
    const f = food({ 'energy-kcal_100g': 500, proteins_100g: 35, carbohydrates_100g: 35, fat_100g: 35 });
    const r = validateProductNutrition(f);
    expect(r.fields.protein_g.status).toBe('valid');
    expect(r.fields.carbs_g.status).toBe('valid');
    expect(r.fields.fat_g.status).toBe('valid');
  });

  it('grasa saturada por encima de la grasa total (fuera de margen) → impossible', () => {
    const f = food({ 'energy-kcal_100g': 400, fat_100g: 5, 'saturated-fat_100g': 20 });
    const r = validateProductNutrition(f);
    expect(r.fields.saturated_fat_g.status).toBe('impossible');
  });

  it('azúcares ligeramente por encima de carbohidratos (redondeo, dentro del margen) → valid', () => {
    const f = food({ 'energy-kcal_100g': 400, carbohydrates_100g: 20, sugars_100g: 22 });
    const r = validateProductNutrition(f);
    expect(r.fields.sugar_g.status).toBe('valid');
  });
});

describe('validateProductNutrition — energía (C)', () => {
  it('kcal físicamente absurdas (2000/100g) → impossible', () => {
    const f = food({ 'energy-kcal_100g': 2000, fat_100g: 10 });
    expect(validateProductNutrition(f).fields.calories).toEqual({
      status: 'impossible',
      reason: 'energy_exceeds_physical_maximum',
    });
  });

  it('aceite puro real (~884 kcal/100g) → valid, sin falso positivo en alimentos concentrados', () => {
    const f = food({ 'energy-kcal_100g': 884, fat_100g: 100 });
    expect(validateProductNutrition(f).fields.calories.status).toBe('valid');
  });
});

describe('validateProductNutrition — sodio/sal (caso explícito del encargo)', () => {
  it('sal de mesa pura (~38.000 mg sodio/100g) → NO impossible', () => {
    const f = food({ 'energy-kcal_100g': 0, sodium_100g: 38 }); // 38 g/100g → 38.000 mg
    const r = validateProductNutrition(f);
    expect(f.sodium_mg).toBe(38000);
    expect(r.fields.sodium_mg.status).not.toBe('impossible');
  });

  it('sodio por encima de lo físicamente posible (>100 g en 100 g de producto) → impossible', () => {
    const f = food({ 'energy-kcal_100g': 0, sodium_100g: 150 }); // 150.000 mg — viola conservación de masa
    expect(validateProductNutrition(f).fields.sodium_mg).toEqual({
      status: 'impossible',
      reason: 'exceeds_mass_conservation',
    });
  });
});

describe('validateProductNutrition — micronutrientes (D): nunca la RDA como techo', () => {
  it('hierro introducido en la unidad equivocada (14 g/100g → 14.000 mg) → impossible', () => {
    // El caso histórico exacto de la auditoría original.
    const f = food({ 'energy-kcal_100g': 100, iron_100g: 14 });
    expect(f.iron_mg).toBe(14000);
    expect(validateProductNutrition(f).fields.iron_mg).toEqual({
      status: 'impossible',
      reason: 'exceeds_realistic_fortification_ceiling',
    });
  });

  it('hierro alto pero razonablemente posible (80 mg, ~444% RDA) → suspicious, NUNCA impossible sólo por superar la RDA', () => {
    const f = food({ 'energy-kcal_100g': 100, iron_100g: 0.08 }); // 80 mg
    const r = validateProductNutrition(f);
    expect(r.fields.iron_mg.status).toBe('suspicious');
  });

  it('B12 de una bebida vegetal fortificada (2 mcg/100g, caso real de la auditoría) → valid', () => {
    const f = food({ 'energy-kcal_100g': 40, 'vitamin-b12_100g': 2e-6 }); // 2 mcg/100g
    expect(validateProductNutrition(f).fields.vitamin_b12_mcg.status).toBe('valid');
  });
});

describe('isSafeToPersist — decisión de bloqueo de guardado (gap de ProductDetailSheet)', () => {
  it('1. macro impossible (protein 40 + carbs 40 + fat 40 = 120) → NO se puede guardar', () => {
    const f = food({ 'energy-kcal_100g': 400, proteins_100g: 40, carbohydrates_100g: 40, fat_100g: 40 });
    const validation = validateProductNutrition(f);
    expect(validation.overall).toBe('has_impossible');
    expect(isSafeToPersist(validation)).toBe(false);
  });

  it('1b. energía físicamente absurda (2000 kcal/100g) → NO se puede guardar, aunque las macros por separado sean razonables', () => {
    const f = food({ 'energy-kcal_100g': 2000, proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2 });
    expect(isSafeToPersist(validateProductNutrition(f))).toBe(false);
  });

  it('2. macro suspicious → SÍ se puede guardar', () => {
    // sodium_mg es de los campos "sin representación de desconocido" (está
    // en la lista que sí puede bloquear si fuera impossible) — aquí se usa
    // en su tramo 'suspicious' (45.000 mg: por encima de la sal de mesa
    // pura ~39.300 mg, pero por debajo de la conservación de masa a
    // 100.000 mg) para probar que 'suspicious' nunca bloquea, ni siquiera
    // en un campo que si fuera 'impossible' sí lo haría.
    const f = food({ 'energy-kcal_100g': 0, sodium_100g: 45 }); // 45.000 mg
    const validation = validateProductNutrition(f);
    expect(validation.fields.sodium_mg.status).toBe('suspicious');
    expect(validation.overall).toBe('has_suspicious');
    expect(isSafeToPersist(validation)).toBe(true);
  });

  it('2b. producto totalmente válido → SÍ se puede guardar', () => {
    const f = food({ 'energy-kcal_100g': 116, proteins_100g: 9, carbohydrates_100g: 20, fat_100g: 0.4 });
    expect(isSafeToPersist(validateProductNutrition(f))).toBe(true);
  });

  it('3. un micronutriente impossible por sí solo NO bloquea el guardado — sigue sin contaminar cálculos, pero el resto de la entry se guarda', () => {
    // Distingue a propósito de los tests 1/1b: un macro/energía impossible
    // bloquea TODO el guardado (no hay forma de "guardar sin ese campo" en
    // food_log); un micronutriente impossible no necesita bloquear nada
    // porque buildEntry() ya sabe excluirlo campo a campo (null +
    // *_known=false) sin tocar el resto — exactamente el comportamiento
    // que ya existía antes de este cambio, que no debe regresar.
    const f = food({ 'energy-kcal_100g': 100, proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2, iron_100g: 14 });
    const validation = validateProductNutrition(f);
    expect(validation.fields.iron_mg.status).toBe('impossible');
    expect(validation.overall).toBe('has_impossible'); // 'overall' sigue sin distinguir macro/micro...
    expect(isSafeToPersist(validation)).toBe(true); // ...pero isSafeToPersist() sí lo hace: esto se puede guardar.
  });
});

describe('validateProductNutrition — no reescribe nada', () => {
  it('el objeto de entrada no se muta', () => {
    const f = food({ 'energy-kcal_100g': 100, iron_100g: 14, proteins_100g: -5 });
    const before = JSON.parse(JSON.stringify(f));
    validateProductNutrition(f);
    expect(f).toEqual(before);
  });

  it('un dato impossible conserva su valor original en el resultado — no se convierte en 0 ni se borra', () => {
    const f = food({ 'energy-kcal_100g': 100, iron_100g: 14 });
    validateProductNutrition(f);
    expect(f.iron_mg).toBe(14000); // el propio FoodPer100g no cambia
  });
});
