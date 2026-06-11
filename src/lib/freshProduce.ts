// Base de datos local de frutas y verduras frescas
// Fuente: BEDCA (Base de Datos Espanola de Composicion de Alimentos) + USDA
// Valores por 100g, en crudo salvo indicacion

export interface FreshItem {
  id: string;
  name: string;
  emoji: string;
  category: 'fruta' | 'verdura' | 'legumbre' | 'cereal' | 'fruto_seco';
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  aliases?: string[];
}

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const FRESH_PRODUCE: FreshItem[] = [
  { id: 'platano', name: 'Platano', emoji: '🍌', category: 'fruta', calories_per_100g: 89, protein_per_100g: 1.1, carbs_per_100g: 23, fat_per_100g: 0.3, fiber_per_100g: 2.6, aliases: ['banana'] },
  { id: 'manzana', name: 'Manzana', emoji: '🍎', category: 'fruta', calories_per_100g: 52, protein_per_100g: 0.3, carbs_per_100g: 14, fat_per_100g: 0.2, fiber_per_100g: 2.4 },
  { id: 'naranja', name: 'Naranja', emoji: '🍊', category: 'fruta', calories_per_100g: 47, protein_per_100g: 0.9, carbs_per_100g: 12, fat_per_100g: 0.1, fiber_per_100g: 2.4 },
  { id: 'pera', name: 'Pera', emoji: '🍐', category: 'fruta', calories_per_100g: 57, protein_per_100g: 0.4, carbs_per_100g: 15, fat_per_100g: 0.1, fiber_per_100g: 3.1 },
  { id: 'uva', name: 'Uva', emoji: '🍇', category: 'fruta', calories_per_100g: 69, protein_per_100g: 0.7, carbs_per_100g: 18, fat_per_100g: 0.2, fiber_per_100g: 0.9 },
  { id: 'fresa', name: 'Fresa', emoji: '🍓', category: 'fruta', calories_per_100g: 33, protein_per_100g: 0.7, carbs_per_100g: 8, fat_per_100g: 0.3, fiber_per_100g: 2.0, aliases: ['freson', 'fresas'] },
  { id: 'melocoton', name: 'Melocoton', emoji: '🍑', category: 'fruta', calories_per_100g: 39, protein_per_100g: 0.9, carbs_per_100g: 10, fat_per_100g: 0.3, fiber_per_100g: 1.5, aliases: ['durazno', 'nectarina'] },
  { id: 'sandia', name: 'Sandia', emoji: '🍉', category: 'fruta', calories_per_100g: 30, protein_per_100g: 0.6, carbs_per_100g: 8, fat_per_100g: 0.2, fiber_per_100g: 0.4 },
  { id: 'melon', name: 'Melon', emoji: '🍈', category: 'fruta', calories_per_100g: 34, protein_per_100g: 0.8, carbs_per_100g: 8, fat_per_100g: 0.2, fiber_per_100g: 0.9 },
  { id: 'kiwi', name: 'Kiwi', emoji: '🥝', category: 'fruta', calories_per_100g: 61, protein_per_100g: 1.1, carbs_per_100g: 15, fat_per_100g: 0.5, fiber_per_100g: 3.0 },
  { id: 'mango', name: 'Mango', emoji: '🥭', category: 'fruta', calories_per_100g: 60, protein_per_100g: 0.8, carbs_per_100g: 15, fat_per_100g: 0.4, fiber_per_100g: 1.6 },
  { id: 'pina', name: 'Pina', emoji: '🍍', category: 'fruta', calories_per_100g: 50, protein_per_100g: 0.5, carbs_per_100g: 13, fat_per_100g: 0.1, fiber_per_100g: 1.4, aliases: ['ananas'] },
  { id: 'cereza', name: 'Cereza', emoji: '🍒', category: 'fruta', calories_per_100g: 63, protein_per_100g: 1.1, carbs_per_100g: 16, fat_per_100g: 0.2, fiber_per_100g: 2.1, aliases: ['picota'] },
  { id: 'limon', name: 'Limon', emoji: '🍋', category: 'fruta', calories_per_100g: 29, protein_per_100g: 1.1, carbs_per_100g: 9, fat_per_100g: 0.3, fiber_per_100g: 2.8 },
  { id: 'aguacate', name: 'Aguacate', emoji: '🥑', category: 'fruta', calories_per_100g: 160, protein_per_100g: 2.0, carbs_per_100g: 9, fat_per_100g: 15, fiber_per_100g: 6.7 },
  { id: 'arandano', name: 'Arandano', emoji: '🫐', category: 'fruta', calories_per_100g: 57, protein_per_100g: 0.7, carbs_per_100g: 14, fat_per_100g: 0.3, fiber_per_100g: 2.4, aliases: ['blueberry', 'arandanos'] },
  { id: 'granada', name: 'Granada', emoji: '🍎', category: 'fruta', calories_per_100g: 83, protein_per_100g: 1.7, carbs_per_100g: 19, fat_per_100g: 1.2, fiber_per_100g: 4.0 },
  { id: 'higo', name: 'Higo', emoji: '🍈', category: 'fruta', calories_per_100g: 74, protein_per_100g: 0.8, carbs_per_100g: 19, fat_per_100g: 0.3, fiber_per_100g: 2.9, aliases: ['breva'] },
  { id: 'mandarina', name: 'Mandarina', emoji: '🍊', category: 'fruta', calories_per_100g: 53, protein_per_100g: 0.8, carbs_per_100g: 13, fat_per_100g: 0.3, fiber_per_100g: 1.8, aliases: ['clementina'] },
  { id: 'papaya', name: 'Papaya', emoji: '🍈', category: 'fruta', calories_per_100g: 43, protein_per_100g: 0.5, carbs_per_100g: 11, fat_per_100g: 0.3, fiber_per_100g: 1.7 },
  { id: 'coco', name: 'Coco (pulpa)', emoji: '🥥', category: 'fruta', calories_per_100g: 354, protein_per_100g: 3.3, carbs_per_100g: 15, fat_per_100g: 33, fiber_per_100g: 9.0 },
  { id: 'higos_secos', name: 'Higos secos', emoji: '🍈', category: 'fruta', calories_per_100g: 249, protein_per_100g: 3.3, carbs_per_100g: 64, fat_per_100g: 0.9, fiber_per_100g: 9.8 },
  { id: 'datil', name: 'Datil', emoji: '🌴', category: 'fruta', calories_per_100g: 282, protein_per_100g: 2.5, carbs_per_100g: 75, fat_per_100g: 0.4, fiber_per_100g: 8.0, aliases: ['datiles'] },
  { id: 'tomate', name: 'Tomate', emoji: '🍅', category: 'verdura', calories_per_100g: 18, protein_per_100g: 0.9, carbs_per_100g: 3.9, fat_per_100g: 0.2, fiber_per_100g: 1.2 },
  { id: 'lechuga', name: 'Lechuga', emoji: '🥬', category: 'verdura', calories_per_100g: 15, protein_per_100g: 1.4, carbs_per_100g: 2.9, fat_per_100g: 0.2, fiber_per_100g: 1.3, aliases: ['hoja de lechuga'] },
  { id: 'espinaca', name: 'Espinaca', emoji: '🥬', category: 'verdura', calories_per_100g: 23, protein_per_100g: 2.9, carbs_per_100g: 3.6, fat_per_100g: 0.4, fiber_per_100g: 2.2, aliases: ['espinacas'] },
  { id: 'zanahoria', name: 'Zanahoria', emoji: '🥕', category: 'verdura', calories_per_100g: 41, protein_per_100g: 0.9, carbs_per_100g: 10, fat_per_100g: 0.2, fiber_per_100g: 2.8, aliases: ['zanahorias'] },
  { id: 'brocoli', name: 'Brocoli', emoji: '🥦', category: 'verdura', calories_per_100g: 34, protein_per_100g: 2.8, carbs_per_100g: 7, fat_per_100g: 0.4, fiber_per_100g: 2.6, aliases: ['brecol'] },
  { id: 'coliflor', name: 'Coliflor', emoji: '🥦', category: 'verdura', calories_per_100g: 25, protein_per_100g: 1.9, carbs_per_100g: 5, fat_per_100g: 0.3, fiber_per_100g: 2.0 },
  { id: 'pimiento', name: 'Pimiento', emoji: '🫑', category: 'verdura', calories_per_100g: 31, protein_per_100g: 1.0, carbs_per_100g: 7, fat_per_100g: 0.3, fiber_per_100g: 2.1, aliases: ['pimiento rojo', 'pimiento verde', 'pimientos'] },
  { id: 'cebolla', name: 'Cebolla', emoji: '🧅', category: 'verdura', calories_per_100g: 40, protein_per_100g: 1.1, carbs_per_100g: 9, fat_per_100g: 0.1, fiber_per_100g: 1.7, aliases: ['cebolleta', 'cebollino'] },
  { id: 'ajo', name: 'Ajo', emoji: '🧄', category: 'verdura', calories_per_100g: 149, protein_per_100g: 6.4, carbs_per_100g: 33, fat_per_100g: 0.5, fiber_per_100g: 2.1 },
  { id: 'pepino', name: 'Pepino', emoji: '🥒', category: 'verdura', calories_per_100g: 15, protein_per_100g: 0.7, carbs_per_100g: 3.6, fat_per_100g: 0.1, fiber_per_100g: 0.5 },
  { id: 'calabacin', name: 'Calabacin', emoji: '🥒', category: 'verdura', calories_per_100g: 17, protein_per_100g: 1.2, carbs_per_100g: 3.1, fat_per_100g: 0.3, fiber_per_100g: 1.0, aliases: ['zucchini'] },
  { id: 'berenjena', name: 'Berenjena', emoji: '🍆', category: 'verdura', calories_per_100g: 25, protein_per_100g: 1.0, carbs_per_100g: 6, fat_per_100g: 0.2, fiber_per_100g: 3.0 },
  { id: 'patata', name: 'Patata', emoji: '🥔', category: 'verdura', calories_per_100g: 77, protein_per_100g: 2.0, carbs_per_100g: 17, fat_per_100g: 0.1, fiber_per_100g: 2.2, aliases: ['papa', 'patatas'] },
  { id: 'boniato', name: 'Boniato', emoji: '🍠', category: 'verdura', calories_per_100g: 86, protein_per_100g: 1.6, carbs_per_100g: 20, fat_per_100g: 0.1, fiber_per_100g: 3.0, aliases: ['batata', 'camote'] },
  { id: 'apio', name: 'Apio', emoji: '🥬', category: 'verdura', calories_per_100g: 16, protein_per_100g: 0.7, carbs_per_100g: 3.0, fat_per_100g: 0.2, fiber_per_100g: 1.6 },
  { id: 'puerro', name: 'Puerro', emoji: '🥬', category: 'verdura', calories_per_100g: 61, protein_per_100g: 1.5, carbs_per_100g: 14, fat_per_100g: 0.3, fiber_per_100g: 1.8, aliases: ['puerros'] },
  { id: 'champinon', name: 'Champinon', emoji: '🍄', category: 'verdura', calories_per_100g: 22, protein_per_100g: 3.1, carbs_per_100g: 3.3, fat_per_100g: 0.3, fiber_per_100g: 1.0, aliases: ['seta', 'setas', 'champinones', 'portobello'] },
  { id: 'col', name: 'Col / Repollo', emoji: '🥬', category: 'verdura', calories_per_100g: 25, protein_per_100g: 1.3, carbs_per_100g: 6, fat_per_100g: 0.1, fiber_per_100g: 2.5, aliases: ['repollo', 'lombarda', 'col lombarda'] },
  { id: 'acelga', name: 'Acelga', emoji: '🥬', category: 'verdura', calories_per_100g: 19, protein_per_100g: 1.8, carbs_per_100g: 3.7, fat_per_100g: 0.2, fiber_per_100g: 1.6, aliases: ['acelgas'] },
  { id: 'rabano', name: 'Rabano', emoji: '🫛', category: 'verdura', calories_per_100g: 16, protein_per_100g: 0.7, carbs_per_100g: 3.4, fat_per_100g: 0.1, fiber_per_100g: 1.6 },
  { id: 'nabo', name: 'Nabo', emoji: '🫛', category: 'verdura', calories_per_100g: 28, protein_per_100g: 0.9, carbs_per_100g: 6, fat_per_100g: 0.1, fiber_per_100g: 1.8 },
  { id: 'esparrago', name: 'Esparrago', emoji: '🌿', category: 'verdura', calories_per_100g: 20, protein_per_100g: 2.2, carbs_per_100g: 3.9, fat_per_100g: 0.1, fiber_per_100g: 2.1, aliases: ['esparragos'] },
  { id: 'alcachofa', name: 'Alcachofa', emoji: '🌿', category: 'verdura', calories_per_100g: 47, protein_per_100g: 3.3, carbs_per_100g: 11, fat_per_100g: 0.2, fiber_per_100g: 5.4, aliases: ['alcachofas'] },
  { id: 'guisante', name: 'Guisante', emoji: '🫛', category: 'legumbre', calories_per_100g: 81, protein_per_100g: 5.4, carbs_per_100g: 14, fat_per_100g: 0.4, fiber_per_100g: 5.1, aliases: ['guisantes', 'arveja'] },
  { id: 'maiz', name: 'Maiz (en grano)', emoji: '🌽', category: 'verdura', calories_per_100g: 86, protein_per_100g: 3.2, carbs_per_100g: 19, fat_per_100g: 1.2, fiber_per_100g: 2.7, aliases: ['maiz dulce', 'choclo'] },
  { id: 'remolacha', name: 'Remolacha', emoji: '🫛', category: 'verdura', calories_per_100g: 43, protein_per_100g: 1.6, carbs_per_100g: 10, fat_per_100g: 0.2, fiber_per_100g: 2.8, aliases: ['betabel'] },
  { id: 'endivia', name: 'Endivia', emoji: '🥬', category: 'verdura', calories_per_100g: 17, protein_per_100g: 1.3, carbs_per_100g: 3.4, fat_per_100g: 0.2, fiber_per_100g: 3.1, aliases: ['escarola'] },
  { id: 'canonigos', name: 'Canonigos', emoji: '🥬', category: 'verdura', calories_per_100g: 21, protein_per_100g: 2.0, carbs_per_100g: 3.6, fat_per_100g: 0.4, fiber_per_100g: 1.7, aliases: ['rúcula', 'rucula'] },
  { id: 'lentejas_cocidas', name: 'Lentejas cocidas', emoji: '🫘', category: 'legumbre', calories_per_100g: 116, protein_per_100g: 9.0, carbs_per_100g: 20, fat_per_100g: 0.4, fiber_per_100g: 7.9, aliases: ['lenteja'] },
  { id: 'garbanzos_cocidos', name: 'Garbanzos cocidos', emoji: '🫘', category: 'legumbre', calories_per_100g: 164, protein_per_100g: 8.9, carbs_per_100g: 27, fat_per_100g: 2.6, fiber_per_100g: 7.6, aliases: ['garbanzo'] },
  { id: 'alubias_cocidas', name: 'Alubias cocidas', emoji: '🫘', category: 'legumbre', calories_per_100g: 127, protein_per_100g: 8.7, carbs_per_100g: 23, fat_per_100g: 0.5, fiber_per_100g: 6.4, aliases: ['judias', 'frijoles', 'habichuelas'] },
  { id: 'edamame', name: 'Edamame', emoji: '🫘', category: 'legumbre', calories_per_100g: 122, protein_per_100g: 11, carbs_per_100g: 10, fat_per_100g: 5.2, fiber_per_100g: 5.2, aliases: ['soja verde'] },
  { id: 'almendra', name: 'Almendra', emoji: '🌰', category: 'fruto_seco', calories_per_100g: 579, protein_per_100g: 21, carbs_per_100g: 22, fat_per_100g: 50, fiber_per_100g: 12.5, aliases: ['almendras'] },
  { id: 'nuez', name: 'Nuez', emoji: '🌰', category: 'fruto_seco', calories_per_100g: 654, protein_per_100g: 15, carbs_per_100g: 14, fat_per_100g: 65, fiber_per_100g: 6.7, aliases: ['nueces'] },
  { id: 'anacardo', name: 'Anacardo', emoji: '🌰', category: 'fruto_seco', calories_per_100g: 553, protein_per_100g: 18, carbs_per_100g: 30, fat_per_100g: 44, fiber_per_100g: 3.3, aliases: ['anacardos', 'cashew'] },
  { id: 'avellana', name: 'Avellana', emoji: '🌰', category: 'fruto_seco', calories_per_100g: 628, protein_per_100g: 15, carbs_per_100g: 17, fat_per_100g: 61, fiber_per_100g: 9.7, aliases: ['avellanas'] },
  { id: 'semilla_chia', name: 'Semilla de chia', emoji: '🌿', category: 'fruto_seco', calories_per_100g: 486, protein_per_100g: 17, carbs_per_100g: 42, fat_per_100g: 31, fiber_per_100g: 34, aliases: ['chia'] },
  { id: 'semilla_lino', name: 'Semilla de lino', emoji: '🌿', category: 'fruto_seco', calories_per_100g: 534, protein_per_100g: 18, carbs_per_100g: 29, fat_per_100g: 42, fiber_per_100g: 27, aliases: ['linaza', 'lino'] },
  { id: 'pipas_girasol', name: 'Pipas de girasol', emoji: '🌻', category: 'fruto_seco', calories_per_100g: 584, protein_per_100g: 21, carbs_per_100g: 20, fat_per_100g: 51, fiber_per_100g: 8.6, aliases: ['semillas girasol', 'pipa'] },
  { id: 'pipas_calabaza', name: 'Pipas de calabaza', emoji: '🎃', category: 'fruto_seco', calories_per_100g: 559, protein_per_100g: 30, carbs_per_100g: 11, fat_per_100g: 49, fiber_per_100g: 6.0, aliases: ['semillas calabaza', 'pepitas'] },
  { id: 'sesamo', name: 'Sesamo', emoji: '🌿', category: 'fruto_seco', calories_per_100g: 573, protein_per_100g: 18, carbs_per_100g: 23, fat_per_100g: 50, fiber_per_100g: 11.8, aliases: ['ajonjoli'] },
];

export function searchFreshProduce(query: string): FreshItem[] {
  if (!query || query.length < 2) return [];
  const q = normalizeSearchText(query);

  return FRESH_PRODUCE.filter((item) => {
    const nameMatch = normalizeSearchText(item.name).includes(q);
    const aliasMatch = item.aliases?.some((alias) => normalizeSearchText(alias).includes(q));
    return nameMatch || aliasMatch;
  }).sort((a, b) => {
    const aStartsWith = normalizeSearchText(a.name).startsWith(q) ? 0 : 1;
    const bStartsWith = normalizeSearchText(b.name).startsWith(q) ? 0 : 1;
    return aStartsWith - bStartsWith;
  });
}

export function freshItemToProduct(item: FreshItem) {
  return {
    code: `fresh_${item.id}`,
    product_name: item.name,
    brands: 'Fresco · BEDCA',
    image_front_url: '',
    categories_tags: [`fresh_${item.category}`],
    labels_tags: ['en:vegan'],
    nutriments: {
      'energy-kcal_100g': item.calories_per_100g,
      proteins_100g: item.protein_per_100g,
      carbohydrates_100g: item.carbs_per_100g,
      fat_100g: item.fat_per_100g,
      fiber_100g: item.fiber_per_100g,
      sugars_100g: 0,
      'saturated-fat_100g': 0,
      sodium_100g: 0,
      'vitamin-b12_100g': null,
      'iron_100g': null,
      'zinc_100g': null,
      'calcium_100g': null,
      'vitamin-d_100g': null,
    },
    serving_size: '100g',
    serving_quantity: 100,
    _isFresh: true,
    _emoji: item.emoji,
  };
}
