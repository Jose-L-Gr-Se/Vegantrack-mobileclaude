/**
 * Auditoría de exportación CSV — `exportDiaryCsv()` leía el histórico
 * DIRECTAMENTE del remoto (Supabase), sin reconciliar con cambios locales
 * aún pendientes de sincronizar (`synced=0` en el espejo SQLite) — el mismo
 * hueco que `fetchEntries()`/`mirrorReplaceDay` ya cierra para el día visible
 * del Diario (ver diaryStore.ts), pero sin cerrar aquí porque este export
 * nunca pasaba por ese camino.
 *
 * Dos casos reproducibles:
 *   1. Editar una entrada y exportar antes de que la edición confirme en el
 *      servidor (offline, o un intento remoto todavía en vuelo) — el CSV
 *      servía el valor ANTIGUO (el que todavía tenía el remoto), no el que
 *      el usuario acababa de guardar y ve en su Diario.
 *   2. Borrar una entrada y exportar antes de que el DELETE remoto confirme
 *      — el CSV seguía incluyendo una fila que el usuario ya había quitado
 *      de su Diario.
 *
 * SQLite real (adaptador de test, mismo patrón que `appStateSync.mutex.
 * test.ts`/`reminders.test.ts`) para el espejo local — así `mirrorPending()`
 * corre sin tocar, con SQL real. Sólo se mockea `@/lib/supabase` (para
 * simular la respuesta remota) y `expo-file-system`/`expo-sharing` (I/O
 * nativo, no es el objeto de este test).
 */
jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

let lastWrittenContent: string | undefined;
jest.mock('expo-file-system', () => ({
  File: class {
    exists = false;
    uri = 'file://mock.csv';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_dir: unknown, _name: string) {}
    create() {}
    delete() {}
    write(content: string) {
      lastWrittenContent = content;
    }
  },
  Paths: { cache: {} },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/hooks/usePro', () => ({ FREE_HISTORY_DAYS: 14 }));

function makeQueryResult(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.gte = jest.fn(() => builder);
  builder.then = (resolve: (v: typeof result) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let mockRemoteResult: { data: unknown; error: unknown };
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));

const USER_ID = 'user-1';

function remoteEntry(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    user_id: USER_ID,
    date: '2026-09-20',
    meal_type: 'lunch',
    food_name: 'Tofu a la plancha',
    barcode: null,
    brand: null,
    serving_size_g: 150,
    calories: 120,
    protein_g: 12,
    carbs_g: 2,
    fat_g: 6,
    fiber_g: 1,
    sugar_g: 0,
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
    created_at: '2026-09-20T12:00:00.000Z',
    updated_at: '2026-09-20T12:00:00.000Z',
    ...over,
  };
}

function freshModules() {
  jest.resetModules();
  lastWrittenContent = undefined;
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => makeQueryResult(mockRemoteResult));
  const db = require('@/db/database') as typeof import('@/db/database');
  const exportCsv = require('@/utils/exportCsv') as typeof import('@/utils/exportCsv');
  return { db, exportCsv };
}

describe('exportDiaryCsv — reconcilia con cambios locales aún no sincronizados', () => {
  it('una edición pendiente (aún no confirmada en el remoto) exporta el valor NUEVO, no el antiguo', async () => {
    const { db, exportCsv } = freshModules();
    mockRemoteResult = { data: [remoteEntry({ calories: 120 })], error: null };

    // La edición ya se aplicó localmente (calorías recalculadas a 200 tras
    // cambiar la ración) pero el intento remoto todavía no ha confirmado —
    // mismo estado que deja `addEntry()` mientras el upsert remoto está en
    // vuelo o falla de forma transitoria (synced sigue en 0).
    await db.mirrorUpsert(
      'food_log',
      { id: 'e1', user_id: USER_ID, date: '2026-09-20', meal_type: 'lunch', payload: remoteEntry({ calories: 200 }) },
      false
    );

    const { error } = await exportCsv.exportDiaryCsv(USER_ID, true);
    expect(error).toBeNull();
    const rows = lastWrittenContent!.split('\n');
    expect(rows).toHaveLength(1 + 1); // cabecera + 1 fila (Pro, sin aviso)
    const cells = rows[1].split(',');
    expect(cells[5]).toBe('200'); // calories — el valor editado, no el remoto (120)
  });

  it('un borrado pendiente (tombstone local aún no confirmado) NO aparece en el CSV', async () => {
    const { db, exportCsv } = freshModules();
    mockRemoteResult = { data: [remoteEntry()], error: null };

    // La entrada llega primero al espejo (como si fetchEntries ya la hubiera
    // visto) y luego se marca para borrar — igual que deleteEntry() cuando
    // el DELETE remoto todavía no ha confirmado.
    await db.mirrorUpsert(
      'food_log',
      { id: 'e1', user_id: USER_ID, date: '2026-09-20', meal_type: 'lunch', payload: remoteEntry() },
      true
    );
    await db.mirrorMarkDeleted('food_log', 'e1');

    const { error } = await exportCsv.exportDiaryCsv(USER_ID, true);
    expect(error).toBeNull();
    const rows = lastWrittenContent!.split('\n');
    expect(rows).toHaveLength(1); // sólo la cabecera — la fila borrada no debe aparecer
  });

  it('un alta pendiente (creada offline, nunca llegó a sincronizar) sí aparece en el CSV', async () => {
    const { db, exportCsv } = freshModules();
    mockRemoteResult = { data: [], error: null }; // el remoto no la conoce todavía

    await db.mirrorUpsert(
      'food_log',
      { id: 'nueva', user_id: USER_ID, date: '2026-09-21', meal_type: 'dinner', payload: remoteEntry({ id: 'nueva', date: '2026-09-21', food_name: 'Garbanzos' }) },
      false
    );

    const { error } = await exportCsv.exportDiaryCsv(USER_ID, true);
    expect(error).toBeNull();
    const rows = lastWrittenContent!.split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Garbanzos');
  });

  it('un alta pendiente fuera de la ventana Free NO se cuela en la exportación Free', async () => {
    const { db, exportCsv } = freshModules();
    mockRemoteResult = { data: [], error: null };

    // Fecha muy anterior a los 14 días de FREE_HISTORY_DAYS mockeados arriba.
    await db.mirrorUpsert(
      'food_log',
      { id: 'vieja', user_id: USER_ID, date: '2020-01-01', meal_type: 'dinner', payload: remoteEntry({ id: 'vieja', date: '2020-01-01' }) },
      false
    );

    const { error } = await exportCsv.exportDiaryCsv(USER_ID, false);
    expect(error).toBeNull();
    const rows = lastWrittenContent!.split('\n');
    // Cabecera + aviso de Free, sin ninguna fila de datos.
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Exportado con VegeTrack Free');
  });

  it('sin nada pendiente, el comportamiento normal (sólo remoto) sigue intacto', async () => {
    const { exportCsv } = freshModules();
    mockRemoteResult = { data: [remoteEntry()], error: null };

    const { error } = await exportCsv.exportDiaryCsv(USER_ID, true);
    expect(error).toBeNull();
    const rows = lastWrittenContent!.split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1].split(',')[5]).toBe('120');
  });

  it('un fallo real de la consulta remota sigue devolviendo el mismo error saneado, sin tocar el espejo local', async () => {
    const { exportCsv } = freshModules();
    mockRemoteResult = { data: null, error: { message: 'network down' } };

    const { error } = await exportCsv.exportDiaryCsv(USER_ID, true);
    expect(error).toBe('No se pudo cargar tu diario. Comprueba tu conexión e inténtalo de nuevo.');
  });
});
