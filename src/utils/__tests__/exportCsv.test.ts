/**
 * Auditoría de CSV/exportación — `buildDiaryCsv` es la generación PURA del
 * contenido (sin I/O), separada a propósito de la escritura/compartición
 * para poder testearla sin mockear ningún módulo nativo (expo-file-system,
 * expo-sharing). El formato de datos no cambia en esta ronda: mismas
 * columnas, mismo escape, mismo aviso de historial recortado para Free.
 */
import { buildDiaryCsv, exportFileName } from '@/utils/exportCsv';
import type { FoodLogEntry } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: {} } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
// `exportCsv.ts` sólo necesita la constante — evita arrastrar authStore →
// purchasesStore → react-native-purchases (una dependencia con ESM que este
// proyecto no transforma en tests).
jest.mock('@/hooks/usePro', () => ({ FREE_HISTORY_DAYS: 14 }));

function entry(over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'e1',
    user_id: 'user-1',
    date: '2026-09-01',
    meal_type: 'lunch',
    food_name: 'Lentejas',
    barcode: null,
    brand: null,
    serving_size_g: 100,
    calories: 300,
    protein_g: 20,
    carbs_g: 30,
    fat_g: 5,
    fiber_g: 8,
    sugar_g: 2,
    saturated_fat_g: 1,
    sodium_mg: 10,
    vitamin_b12_mcg: null,
    iron_mg: 3.2,
    zinc_mg: null,
    calcium_mg: null,
    omega3_g: null,
    vitamin_d_mcg: null,
    vitamin_b12_known: false,
    iron_known: true,
    zinc_known: false,
    calcium_known: false,
    omega3_known: false,
    vitamin_d_known: false,
    source: 'openfoodfacts',
    source_ref: null,
    is_vegan: true,
    image_url: null,
    created_at: '2026-09-01T12:00:00Z',
    ...over,
  } as FoodLogEntry;
}

describe('buildDiaryCsv — generación pura del CSV', () => {
  it('la cabecera tiene exactamente las 20 columnas de siempre, en el mismo orden', () => {
    const csv = buildDiaryCsv([], true);
    expect(csv.split('\n')[0]).toBe(
      'date,meal_type,food_name,brand,serving_size_g,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,' +
        'saturated_fat_g,sodium_mg,vitamin_b12_mcg,iron_mg,zinc_mg,calcium_mg,omega3_g,vitamin_d_mcg,is_vegan'
    );
  });

  it('un valor null/undefined se exporta como celda vacía, no como "null" ni "0"', () => {
    const csv = buildDiaryCsv([entry({ vitamin_b12_mcg: null, brand: null })], true);
    const cells = csv.split('\n')[1].split(',');
    expect(cells[3]).toBe(''); // brand
    expect(cells[13]).toBe(''); // vitamin_b12_mcg
  });

  it('un valor conocido de 0 se exporta como "0", distinto de una celda vacía', () => {
    const csv = buildDiaryCsv([entry({ iron_mg: 0, iron_known: true })], true);
    const cells = csv.split('\n')[1].split(',');
    expect(cells[14]).toBe('0'); // iron_mg
  });

  it('escapa comas, comillas y saltos de línea en food_name/brand', () => {
    // Nota: el propio valor de `brand` contiene un salto de línea real, así
    // que la fila lógica del CSV ocupa dos líneas de texto — se busca en el
    // string completo, no en un `split('\n')` ingenuo que la partiría.
    const csv = buildDiaryCsv(
      [entry({ food_name: 'Curry, con "coco"', brand: 'Marca\ncon salto' })],
      true
    );
    expect(csv).toContain('"Curry, con ""coco"""');
    expect(csv).toContain('"Marca\ncon salto"');
  });

  it('Free añade la línea de aviso de historial recortado; Pro no', () => {
    const csvFree = buildDiaryCsv([entry()], false);
    const csvPro = buildDiaryCsv([entry()], true);
    expect(csvFree).toContain('# Exportado con VegeTrack Free (últimos 14 días)');
    expect(csvPro).not.toContain('# Exportado con VegeTrack Free');
  });

  it('sin filas, sólo queda la cabecera (Pro) o cabecera + aviso (Free)', () => {
    expect(buildDiaryCsv([], true).split('\n')).toHaveLength(1);
    expect(buildDiaryCsv([], false).split('\n')).toHaveLength(2);
  });

  it('varias filas mantienen el orden por el que llegan (ya vienen ordenadas por fecha desde la query)', () => {
    const csv = buildDiaryCsv(
      [entry({ id: 'a', food_name: 'Uno' }), entry({ id: 'b', food_name: 'Dos' })],
      true
    );
    const lines = csv.split('\n');
    expect(lines[1]).toContain('Uno');
    expect(lines[2]).toContain('Dos');
  });
});

describe('exportFileName', () => {
  it('produce el nombre real del archivo con la fecha dada', () => {
    expect(exportFileName('2026-09-08')).toBe('vegantrack-diario-2026-09-08.csv');
  });
});
