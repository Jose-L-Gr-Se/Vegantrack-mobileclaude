/**
 * Integración con OpenFoodFacts.
 * Portada de la PWA con una mejora: el caché de barcodes vive en SQLite local
 * (off_cache) en vez de en la tabla food_cache de Supabase → funciona offline
 * y no consume cuota.
 *
 * Unidades: OFF reporta TODOS los nutrientes en gramos por 100 g.
 * Conversión a unidades de la app: B12/VitD ×1e6 → mcg; Fe/Zn/Ca/Na ×1000 → mg.
 */
import type { FoodPer100g, OpenFoodFactsProduct, VeganConfidence } from '@/types';
import { cacheOffProduct, getCachedOffProduct } from '@/db/database';

const BASE_URL = 'https://world.openfoodfacts.net';
const FIELDS =
  'code,product_name,brands,image_front_url,image_front_small_url,image_front_thumb_url,nutriments,labels_tags,categories_tags,serving_size,serving_quantity,nutriscore_grade,ecoscore_grade,nova_group,ingredients_text';

export interface SearchResult {
  products: OpenFoodFactsProduct[];
  count: number;
  page: number;
}

function createTimeout(ms = 10000): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

export async function getProductByBarcode(barcode: string): Promise<OpenFoodFactsProduct | null> {
  // 1. Caché local SQLite (TTL 7 días)
  try {
    const cached = await getCachedOffProduct(barcode);
    if (cached) return normalizeProduct(cached);
  } catch {
    // caché corrupta: seguimos a red
  }

  // 2. Red
  const { signal, clear } = createTimeout();
  try {
    const res = await fetch(`${BASE_URL}/api/v2/product/${barcode}?fields=${FIELDS}`, { signal });
    clear();
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 1 && data.product) {
      void cacheOffProduct(barcode, data.product);
      return normalizeProduct(data.product);
    }
    return null;
  } catch {
    clear();
    return null;
  }
}

export async function searchProducts(
  query: string,
  page = 1,
  veganOnly = false
): Promise<SearchResult> {
  const { signal, clear } = createTimeout();
  try {
    let url = `${BASE_URL}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page=${page}&page_size=20&fields=${FIELDS}`;
    if (veganOnly) {
      url += '&tagtype_0=labels&tag_contains_0=contains&tag_0=en:vegan';
    }
    const res = await fetch(url, { signal });
    clear();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      products: (data.products || [])
        .map(normalizeProduct)
        .filter((p: OpenFoodFactsProduct) => p.product_name),
      count: data.count || 0,
      page: data.page || 1,
    };
  } catch {
    clear();
    return { products: [], count: 0, page: 1 };
  }
}

// ── Detección de vegano ─────────────────────────────────────────────────────

const ANIMAL_KEYWORDS = [
  'pollo', 'pavo', 'ternera', 'cerdo', 'cordero', 'buey', 'vaca',
  'jamón serrano', 'jamón ibérico', 'jamón cocido',
  'atún claro', 'salmón ahumado', 'anchoas', 'bacalao', 'merluza',
  'gambas', 'langostino', 'pulpo', 'calamar', 'mejillón',
  'huevo campero', 'huevos de gallina',
  'leche entera', 'leche semidesnatada', 'leche desnatada',
  'queso manchego', 'queso curado', 'mozzarella di bufala',
  'yogur griego', 'yogur natural',
  'mantequilla de vaca', 'nata para montar',
  'chicken', 'turkey', 'beef', 'pork', 'lamb', 'duck',
  'cow milk', 'goat milk', 'whey', 'casein', 'lactose',
  'egg white', 'egg yolk',
  'tuna fish', 'salmon fillet', 'shrimp', 'prawn',
  'gelatin', 'gelatina', 'colágeno', 'collagen',
];

const VEGAN_POSITIVE_KEYWORDS = [
  'vegano', 'vegana', 'vegan', 'vegetal', 'vegetariano', 'vegetariana',
  'plant-based', 'plant based', 'a base de plantas',
  'soja', 'soy', 'tofu', 'seitán', 'seitan', 'tempeh',
  'avena', 'oat', 'almendra', 'almond', 'coco', 'coconut',
  'arroz', 'rice', 'guisante', 'pea protein', 'proteína de guisante',
  'heura', 'beyond', 'impossible', 'garden gourmet',
  'sin lactosa vegetal', 'alternativa vegetal',
];

export function isProductVegan(product: OpenFoodFactsProduct): boolean {
  return (product.labels_tags || []).some(
    (tag) => tag === 'en:vegan' || tag === 'en:vegan-society'
  );
}

/**
 * Confianza en que un producto sea vegano:
 * 'high' = sello vegano · 'low' = keywords animales ·
 * 'medium' = señales veganas en nombre/marca · 'unknown' = sin señal.
 */
export function getVeganConfidence(product: OpenFoodFactsProduct): VeganConfidence {
  const labels = product.labels_tags || [];
  if (labels.some((t) => t === 'en:vegan' || t === 'en:vegan-society')) return 'high';

  const combined = `${product.product_name} ${product.brands}`.toLowerCase();
  if (ANIMAL_KEYWORDS.some((kw) => combined.includes(kw.toLowerCase()))) return 'low';
  if (VEGAN_POSITIVE_KEYWORDS.some((kw) => combined.includes(kw.toLowerCase()))) return 'medium';
  return 'unknown';
}

// ── Alternativas veganas ────────────────────────────────────────────────────

type SubstituteType = 'protein' | 'dairy' | 'fat' | 'general';

const VEGAN_ALTERNATIVES_MAP: { keywords: string[]; queries: string[]; type: SubstituteType }[] = [
  { keywords: ['yogurt', 'yogur', 'yoghurt', 'yaourt', 'fromage-blanc'], queries: ['yogur vegetal soja', 'yogur vegetal avena', 'yogur vegano'], type: 'dairy' },
  { keywords: ['cheese', 'queso', 'fromage', 'käse', 'mozzarella', 'cheddar', 'gouda', 'emmental', 'brie', 'camembert', 'manchego', 'parmigiano', 'parmesan'], queries: ['queso vegano', 'queso vegetal'], type: 'dairy' },
  { keywords: ['milk', 'leche', 'lait', 'milch', 'whole-milk', 'semi-skimmed-milk', 'skimmed-milk'], queries: ['bebida soja', 'bebida avena', 'leche vegetal'], type: 'dairy' },
  { keywords: ['cream', 'nata', 'crème', 'crema-de-leche', 'heavy-cream', 'whipping-cream'], queries: ['nata vegetal cocina', 'crema vegetal'], type: 'fat' },
  { keywords: ['butter', 'mantequilla', 'beurre', 'margarina'], queries: ['margarina vegetal', 'mantequilla vegana'], type: 'fat' },
  { keywords: ['ice-cream', 'helado', 'glace', 'gelato'], queries: ['helado vegano', 'helado vegetal soja'], type: 'general' },
  { keywords: ['ham', 'jamón', 'jamon', 'jambon', 'prosciutto'], queries: ['fiambre vegetal', 'embutido vegetal lonchas'], type: 'protein' },
  { keywords: ['sausage', 'salchicha', 'chorizo', 'saucisse', 'frankfurter', 'wurst', 'hot-dog'], queries: ['salchicha vegetal', 'frankfurt vegetal'], type: 'protein' },
  { keywords: ['burger', 'hamburguesa', 'patty', 'steak-hache'], queries: ['hamburguesa vegetal proteína', 'burger vegana soja'], type: 'protein' },
  { keywords: ['chicken', 'pollo', 'poulet', 'nugget', 'escalope'], queries: ['heura', 'tiras vegetales proteína', 'nuggets vegetales soja'], type: 'protein' },
  { keywords: ['meat', 'carne', 'viande', 'beef', 'ternera', 'cerdo', 'pork', 'porc'], queries: ['seitán', 'proteína vegetal soja texturizada', 'carne vegetal'], type: 'protein' },
  { keywords: ['bacon', 'panceta', 'tocino'], queries: ['bacon vegano', 'bacon vegetal'], type: 'protein' },
  { keywords: ['tuna', 'atún', 'atun', 'thon'], queries: ['atún vegano', 'atún vegetal'], type: 'protein' },
  { keywords: ['fish', 'pescado', 'poisson', 'salmon', 'salmón', 'sardine', 'anchoa', 'anchovy'], queries: ['pescado vegano', 'tofu'], type: 'protein' },
  { keywords: ['shrimp', 'prawn', 'gamba', 'crevette', 'marisco', 'seafood'], queries: ['proteína vegetal marisco', 'alternativa vegana marisco'], type: 'protein' },
  { keywords: ['egg', 'huevo', 'oeuf', 'eier'], queries: ['tofu sedoso', 'sustituto huevo vegano'], type: 'protein' },
  { keywords: ['mayonnaise', 'mayonesa', 'mayo'], queries: ['mayonesa vegana', 'veganesa'], type: 'fat' },
  { keywords: ['chocolate-milk', 'batido', 'milkshake', 'cacao-milk'], queries: ['batido vegetal soja', 'batido avena cacao'], type: 'dairy' },
  { keywords: ['pizza'], queries: ['pizza vegana', 'pizza vegetal'], type: 'general' },
];

const IRRELEVANT_KEYWORDS = [
  'sazonador', 'seasoning', 'especias', 'spice', 'condimento',
  'salsa', 'sauce', 'ketchup', 'mostaza', 'vinagre',
  'caldo', 'bouillon', 'broth',
  'suplemento', 'supplement', 'vitamina', 'cápsula', 'capsule',
  'bebida energética', 'energy drink',
  'patatas fritas', 'chips',
  'mermelada', 'jam', 'miel', 'honey',
];

function looksVegan(product: OpenFoodFactsProduct): boolean {
  if (isProductVegan(product)) return true;
  const combined = `${product.product_name} ${product.brands || ''}`.toLowerCase();
  for (const kw of ANIMAL_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) return false;
  }
  for (const kw of VEGAN_POSITIVE_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) return true;
  }
  return false;
}

function isRelevantSubstitute(product: OpenFoodFactsProduct): boolean {
  const combined = `${product.product_name.toLowerCase()} ${product.categories_tags.join(' ').toLowerCase()}`;
  for (const kw of IRRELEVANT_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) return false;
  }
  if (product.nutriments['energy-kcal_100g'] <= 5) return false;
  return true;
}

function nutritionSimilarityScore(
  original: OpenFoodFactsProduct,
  candidate: OpenFoodFactsProduct,
  type: SubstituteType
): number {
  const oN = original.nutriments;
  const cN = candidate.nutriments;
  const protDiff = Math.abs(oN.proteins_100g - cN.proteins_100g);
  const carbDiff = Math.abs(oN.carbohydrates_100g - cN.carbohydrates_100g);
  const fatDiff = Math.abs(oN.fat_100g - cN.fat_100g);
  const kcalDiff = Math.abs(oN['energy-kcal_100g'] - cN['energy-kcal_100g']);

  switch (type) {
    case 'protein': {
      const proteinPenalty = cN.proteins_100g < oN.proteins_100g * 0.5 ? 100 : 0;
      return protDiff * 4 + fatDiff * 1 + carbDiff * 0.5 + kcalDiff * 0.1 + proteinPenalty;
    }
    case 'dairy':
      return protDiff * 2 + fatDiff * 2 + carbDiff * 1 + kcalDiff * 0.2;
    case 'fat':
      return fatDiff * 4 + kcalDiff * 0.5 + protDiff * 0.5 + carbDiff * 0.5;
    case 'general':
    default:
      return protDiff * 1.5 + fatDiff * 1.5 + carbDiff * 1 + kcalDiff * 0.3;
  }
}

function findMappedEntry(
  product: OpenFoodFactsProduct
): (typeof VEGAN_ALTERNATIVES_MAP)[number] | null {
  const haystack = [
    ...product.categories_tags.map((t) => t.toLowerCase()),
    product.product_name.toLowerCase(),
  ].join(' ');
  for (const mapping of VEGAN_ALTERNATIVES_MAP) {
    for (const kw of mapping.keywords) {
      if (haystack.includes(kw)) return mapping;
    }
  }
  return null;
}

function extractGenericTerm(productName: string): string | null {
  const name = productName.toLowerCase();
  const genericTerms = [
    'yogur', 'yogurt', 'queso', 'leche', 'nata', 'crema', 'mantequilla',
    'helado', 'jamón', 'jamon', 'salchicha', 'chorizo', 'hamburguesa',
    'burger', 'nugget', 'pollo', 'carne', 'atún', 'atun', 'pescado',
    'salmón', 'salmon', 'huevo', 'mayonesa', 'pizza', 'bacon',
    'embutido', 'fiambre', 'salami', 'mortadela', 'paté', 'pate',
    'mozzarella', 'cheddar', 'batido',
    'cheese', 'milk', 'cream', 'butter', 'chicken', 'meat', 'fish',
    'tuna', 'egg', 'sausage', 'ham', 'ice cream',
  ];
  for (const term of genericTerms) {
    if (name.includes(term)) return term;
  }
  return null;
}

export async function findVeganAlternatives(
  product: OpenFoodFactsProduct
): Promise<OpenFoodFactsProduct[]> {
  const mappedEntry = findMappedEntry(product);
  const queries: string[] = mappedEntry ? [...mappedEntry.queries] : [];
  const type: SubstituteType = mappedEntry?.type || 'general';

  if (queries.length === 0) {
    const generic = extractGenericTerm(product.product_name);
    if (generic) queries.push(`${generic} vegano`, `${generic} vegetal`);
  }
  if (queries.length === 0) return [];

  const allCandidates: OpenFoodFactsProduct[] = [];
  const seenCodes = new Set<string>();

  for (const q of queries) {
    const { signal, clear } = createTimeout(8000);
    try {
      const res = await fetch(
        `${BASE_URL}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&json=1&page_size=15&fields=${FIELDS}`,
        { signal }
      );
      clear();
      if (!res.ok) continue;
      const data = await res.json();
      const products: OpenFoodFactsProduct[] = (data.products || [])
        .map(normalizeProduct)
        .filter((p: OpenFoodFactsProduct) => {
          if (!p.product_name) return false;
          if (p.code === product.code) return false;
          if (seenCodes.has(p.code)) return false;
          return true;
        });
      for (const p of products) {
        seenCodes.add(p.code);
        allCandidates.push(p);
      }
    } catch {
      clear();
      continue;
    }
  }

  const scored = allCandidates
    .filter(looksVegan)
    .filter(isRelevantSubstitute)
    .map((candidate) => ({
      product: candidate,
      score: nutritionSimilarityScore(product, candidate, type),
    }));

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, 5).map((s) => s.product);
}

// ── Normalización y conversión de unidades ──────────────────────────────────

function numberOrZero(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function gradeOrNull(value: unknown): 'a' | 'b' | 'c' | 'd' | 'e' | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  return v === 'a' || v === 'b' || v === 'c' || v === 'd' || v === 'e' ? v : null;
}

function novaOrNull(value: unknown): 1 | 2 | 3 | 4 | null {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 || n === 4 ? (n as 1 | 2 | 3 | 4) : null;
}

export function normalizeProduct(raw: any): OpenFoodFactsProduct {
  const n = raw.nutriments || {};
  return {
    code: raw.code || '',
    product_name: raw.product_name || '',
    brands: raw.brands || '',
    image_front_url: raw.image_front_url || '',
    image_front_large_url: raw.image_front_url || null,
    ingredients_text: typeof raw.ingredients_text === 'string' ? raw.ingredients_text : null,
    nutriscore_grade: gradeOrNull(raw.nutriscore_grade),
    ecoscore_grade: gradeOrNull(raw.ecoscore_grade),
    nova_group: novaOrNull(raw.nova_group),
    categories_tags: Array.isArray(raw.categories_tags) ? raw.categories_tags : [],
    labels_tags: Array.isArray(raw.labels_tags) ? raw.labels_tags : [],
    nutriments: {
      // Macros: 0 cuando faltan (siempre número)
      'energy-kcal_100g': numberOrZero(n['energy-kcal_100g']),
      proteins_100g: numberOrZero(n.proteins_100g),
      carbohydrates_100g: numberOrZero(n.carbohydrates_100g),
      fat_100g: numberOrZero(n.fat_100g),
      fiber_100g: numberOrZero(n.fiber_100g),
      sugars_100g: numberOrZero(n.sugars_100g),
      'saturated-fat_100g': numberOrZero(n['saturated-fat_100g']),
      sodium_100g: numberOrZero(n.sodium_100g),
      salt_100g: numberOrZero(n.salt_100g),
      // Micros: null cuando no se reportan; nunca colapsar a 0
      'vitamin-b12_100g': numberOrNull(n['vitamin-b12_100g']),
      iron_100g: numberOrNull(n['iron_100g']),
      zinc_100g: numberOrNull(n['zinc_100g']),
      calcium_100g: numberOrNull(n['calcium_100g']),
      'vitamin-d_100g': numberOrNull(n['vitamin-d_100g']),
    },
    serving_size: raw.serving_size || '',
    serving_quantity: numberOrZero(raw.serving_quantity),
  };
}

/** Convierte un producto OFF a alimento por-100g en las unidades de la app. */
export function productToFoodPer100g(product: OpenFoodFactsProduct): FoodPer100g {
  const n = product.nutriments;
  const b12 = n['vitamin-b12_100g'] !== null ? n['vitamin-b12_100g']! * 1e6 : null;
  const vitD = n['vitamin-d_100g'] !== null ? n['vitamin-d_100g']! * 1e6 : null;
  const iron = n.iron_100g !== null ? n.iron_100g! * 1000 : null;
  const zinc = n.zinc_100g !== null ? n.zinc_100g! * 1000 : null;
  const calcium = n.calcium_100g !== null ? n.calcium_100g! * 1000 : null;

  return {
    food_name: product.product_name,
    brand: product.brands || null,
    barcode: product.code || null,
    image_url: product.image_front_url || null,
    is_vegan: isProductVegan(product),
    source: product.code ? 'openfoodfacts' : 'manual',
    source_ref: product.code || null,
    calories: n['energy-kcal_100g'],
    protein_g: n.proteins_100g,
    carbs_g: n.carbohydrates_100g,
    fat_g: n.fat_100g,
    fiber_g: n.fiber_100g,
    sugar_g: n.sugars_100g,
    saturated_fat_g: n['saturated-fat_100g'],
    sodium_mg: n.sodium_100g * 1000,
    vitamin_b12_mcg: b12,
    iron_mg: iron,
    zinc_mg: zinc,
    calcium_mg: calcium,
    omega3_g: null, // OFF no lo reporta de forma fiable
    vitamin_d_mcg: vitD,
    vitamin_b12_known: b12 !== null,
    iron_known: iron !== null,
    zinc_known: zinc !== null,
    calcium_known: calcium !== null,
    omega3_known: false,
    vitamin_d_known: vitD !== null,
    nutriscore_grade: product.nutriscore_grade ?? null,
    ecoscore_grade: product.ecoscore_grade ?? null,
    nova_group: product.nova_group ?? null,
    ingredients_text: product.ingredients_text ?? null,
    salt_g: typeof product.nutriments.salt_100g === 'number' ? product.nutriments.salt_100g : null,
    image_large_url: product.image_front_large_url ?? null,
  };
}
