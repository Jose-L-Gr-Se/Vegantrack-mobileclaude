/** Normalización OFF y conversión de unidades (OFF reporta todo en gramos). */
import { getVeganConfidence, normalizeProduct, productToFoodPer100g } from '@/lib/openfoodfacts';

jest.mock('@/db/database', () => ({
  getCachedOffProduct: jest.fn().mockResolvedValue(null),
  cacheOffProduct: jest.fn().mockResolvedValue(undefined),
}));

const rawProduct = {
  code: '5601234567890',
  product_name: 'Bebida de soja',
  brands: 'TestBrand',
  image_front_url: 'https://img.example/x.jpg',
  categories_tags: ['en:plant-based-foods'],
  labels_tags: ['en:vegan'],
  nutriments: {
    'energy-kcal_100g': 42,
    proteins_100g: 3.3,
    carbohydrates_100g: 2.1,
    fat_100g: 1.9,
    fiber_100g: 0.5,
    sugars_100g: 2.0,
    'saturated-fat_100g': 0.3,
    sodium_100g: 0.04,
    'vitamin-b12_100g': 3.8e-7, // 0.38 mcg
    calcium_100g: 0.12, // 120 mg
  },
  serving_size: '250ml',
  serving_quantity: 250,
};

describe('normalizeProduct', () => {
  it('macros ausentes → 0; micros ausentes → null', () => {
    const p = normalizeProduct({ code: 'x', product_name: 'Y', nutriments: {} });
    expect(p.nutriments['energy-kcal_100g']).toBe(0);
    expect(p.nutriments.proteins_100g).toBe(0);
    expect(p.nutriments.iron_100g).toBeNull();
    expect(p.nutriments['vitamin-b12_100g']).toBeNull();
  });

  it('conserva valores reportados', () => {
    const p = normalizeProduct(rawProduct);
    expect(p.nutriments['energy-kcal_100g']).toBe(42);
    expect(p.nutriments.calcium_100g).toBe(0.12);
  });
});

describe('productToFoodPer100g', () => {
  it('convierte gramos de OFF a unidades de la app', () => {
    const f = productToFoodPer100g(normalizeProduct(rawProduct));
    expect(f.sodium_mg).toBe(40); // 0.04 g → 40 mg
    expect(f.calcium_mg).toBe(120); // 0.12 g → 120 mg
    expect(f.vitamin_b12_mcg).toBeCloseTo(0.38); // 3.8e-7 g → 0.38 mcg
    expect(f.calcium_known).toBe(true);
    expect(f.iron_known).toBe(false);
    expect(f.iron_mg).toBeNull();
    expect(f.is_vegan).toBe(true);
    expect(f.source).toBe('openfoodfacts');
  });
});

describe('getVeganConfidence', () => {
  const make = (over: object) => normalizeProduct({ code: 'x', product_name: 'Producto', nutriments: {}, ...over });

  it('sello vegano → high', () => {
    expect(getVeganConfidence(make({ labels_tags: ['en:vegan'] }))).toBe('high');
  });

  it('keywords animales → low', () => {
    expect(getVeganConfidence(make({ product_name: 'Yogur griego natural' }))).toBe('low');
  });

  it('señales veganas → medium', () => {
    expect(getVeganConfidence(make({ product_name: 'Hamburguesa de seitán' }))).toBe('medium');
  });

  it('sin señal → unknown', () => {
    expect(getVeganConfidence(make({ product_name: 'Galletas de chocolate' }))).toBe('unknown');
  });
});
