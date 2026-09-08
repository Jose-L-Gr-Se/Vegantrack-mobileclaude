/**
 * Auditoría de CSV/exportación — flujo real de escritura/compartición
 * (`writeAndShareCsv`/`exportDiaryCsv`). Cubre el hallazgo P0 central: el
 * CSV ya nunca debe pasar por `Share.share`/`Intent.EXTRA_TEXT` (Android),
 * ni siquiera con un historial grande — ahora se escribe un fichero real en
 * `Paths.cache` (expo-file-system) y se comparte esa URI con `expo-sharing`.
 */
import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { exportDiaryCsv, writeAndShareCsv } from '@/utils/exportCsv';
import type { FoodLogEntry } from '@/types';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@/hooks/usePro', () => ({ FREE_HISTORY_DAYS: 14 }));

const mockFileCreate = jest.fn();
const mockFileWrite = jest.fn();
const mockFileDelete = jest.fn();
let mockFileExists = false;
const MOCK_URI = 'file:///cache/vegantrack-diario-2026-09-08.csv';

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    get exists() {
      return mockFileExists;
    },
    create: (...args: unknown[]) => mockFileCreate(...args),
    write: (...args: unknown[]) => mockFileWrite(...args),
    delete: (...args: unknown[]) => mockFileDelete(...args),
    uri: MOCK_URI,
  })),
  Paths: { cache: {} },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

const USER_ID = 'user-1';

function entry(id: string, date: string): FoodLogEntry {
  return {
    id,
    user_id: USER_ID,
    date,
    meal_type: 'lunch',
    food_name: `Alimento ${id}`,
    brand: null,
    serving_size_g: 100,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sugar_g: 1,
    saturated_fat_g: 1,
    sodium_mg: 5,
    vitamin_b12_mcg: null,
    iron_mg: null,
    zinc_mg: null,
    calcium_mg: null,
    omega3_g: null,
    vitamin_d_mcg: null,
    vitamin_b12_known: false,
    iron_known: false,
    zinc_known: false,
    calcium_known: false,
    omega3_known: false,
    vitamin_d_known: false,
    source: 'openfoodfacts',
    source_ref: null,
    is_vegan: true,
    image_url: null,
    created_at: `${date}T12:00:00Z`,
  } as FoodLogEntry;
}

/** Builder de `food_log` controlable: reproduce la query real de
 * `exportDiaryCsv` (select + eq + order[ + gte]), capturando qué filtros
 * se aplicaron para poder comprobar el gate Free/Pro. */
function mockFoodLogQuery(result: { data: FoodLogEntry[] | null; error: { message: string } | null }) {
  const calls: { gte?: [string, string] } = {};
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    gte: (col: string, val: string) => {
      calls.gte = [col, val];
      return builder;
    },
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  mockFrom.mockReturnValue(builder);
  return calls;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockFileExists = false;
  alertSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('exportDiaryCsv — nunca pasa por Share.share/EXTRA_TEXT, ni con historial grande', () => {
  it('con un historial de 5000 filas, comparte un archivo real y JAMÁS llama a Share.share', async () => {
    const bigHistory = Array.from({ length: 5000 }, (_, i) => entry(`e${i}`, '2026-01-01'));
    mockFoodLogQuery({ data: bigHistory, error: null });

    const { error } = await exportDiaryCsv(USER_ID, true); // Pro: sin límite de días

    expect(error).toBeNull();
    expect(Share.share).not.toHaveBeenCalled(); // el hallazgo P0 central
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
    const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
    expect(uri).toBe(MOCK_URI);
    expect(options).toMatchObject({ mimeType: 'text/csv' });

    // El contenido escrito en el archivo tiene cabecera + 5000 filas (Pro: sin línea de aviso).
    const writtenContent = mockFileWrite.mock.calls[0][0] as string;
    expect(writtenContent.split('\n')).toHaveLength(5001);
  });

  it('el nombre del archivo real es vegantrack-diario-YYYY-MM-DD.csv', async () => {
    mockFoodLogQuery({ data: [], error: null });
    await exportDiaryCsv(USER_ID, true);

    const fileCtor = File as unknown as jest.Mock;
    const [, filename] = fileCtor.mock.calls[0];
    expect(filename).toMatch(/^vegantrack-diario-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('Free filtra por los últimos 14 días (gte); Pro no aplica ningún filtro de fecha', async () => {
    const callsFree = mockFoodLogQuery({ data: [], error: null });
    await exportDiaryCsv(USER_ID, false);
    expect(callsFree.gte?.[0]).toBe('date');

    jest.clearAllMocks();
    mockFileExists = false;
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
    const callsPro = mockFoodLogQuery({ data: [], error: null });
    await exportDiaryCsv(USER_ID, true);
    expect(callsPro.gte).toBeUndefined();
  });

  it('un error de Supabase nunca expone el mensaje técnico crudo', async () => {
    mockFoodLogQuery({ data: null, error: { message: 'permission denied for table food_log' } });
    const { error } = await exportDiaryCsv(USER_ID, true);
    expect(error).not.toBeNull();
    expect(error).not.toContain('permission denied');
    expect(error).not.toContain('food_log');
  });

  it('sin sharing disponible en el dispositivo, no se llega a escribir ningún archivo', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const { error } = await writeAndShareCsv('vegantrack-diario-2026-09-08.csv', 'date\n');
    expect(error).not.toBeNull();
    expect(mockFileWrite).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('si escribir el archivo falla, devuelve un error sin intentar compartir', async () => {
    mockFileWrite.mockImplementation(() => {
      throw new Error('disk full');
    });
    const { error } = await writeAndShareCsv('vegantrack-diario-2026-09-08.csv', 'date\n');
    expect(error).not.toBeNull();
    expect(error).not.toContain('disk full');
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('si compartir falla (hoja nativa cancelada con error), devuelve un error genérico', async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('native share failed'));
    const { error } = await writeAndShareCsv('vegantrack-diario-2026-09-08.csv', 'date\n');
    expect(error).not.toBeNull();
    expect(error).not.toContain('native share failed');
  });

  it('si ya existe un archivo con el mismo nombre (export previo del mismo día), se borra antes de escribir el nuevo', async () => {
    mockFileExists = true;
    await writeAndShareCsv('vegantrack-diario-2026-09-08.csv', 'date\n');
    expect(mockFileDelete).toHaveBeenCalledTimes(1);
    expect(mockFileCreate).toHaveBeenCalledTimes(1);
  });

  it('si no existe ningún archivo previo, no se intenta borrar nada', async () => {
    mockFileExists = false;
    await writeAndShareCsv('vegantrack-diario-2026-09-08.csv', 'date\n');
    expect(mockFileDelete).not.toHaveBeenCalled();
    expect(mockFileCreate).toHaveBeenCalledTimes(1);
  });
});
