/**
 * Auditoría del Diario — cierre de los Bugs D y E: `copyDayEntries`/
 * `copyMealEntries` reutilizan `addEntry()` fila a fila (Diseño 1) en vez
 * de un SELECT+INSERT en lote directo. Offline-first real, idempotencia
 * sin idempotency-key (id generado una vez, upsert por PK ya existente),
 * y ningún fallo intermedio aborta el resto del lote.
 *
 * SQLite real (better-sqlite3) + un "servidor" Supabase simulado con
 * semántica de filtro real (no un builder ad-hoc por test): un array
 * mutable de filas que el mock de `select`/`upsert`/`delete` consulta y
 * modifica de verdad, para poder ejercitar en el mismo fichero tanto
 * `copyEntries` (SELECT de origen) como `addEntry`/`fetchEntries`/
 * `flushPending` reales sin necesitar mocks distintos por test.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { FoodLogEntry } from '@/types';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFrom = jest.fn();
const mockRpc = jest.fn((..._args: unknown[]) => Promise.resolve({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const mockReportError = jest.fn();
jest.mock('@/lib/errorReporting', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: jest.fn(),
}));

const USER_ID = 'user-1';
const YESTERDAY = '2026-09-06';
const TODAY = '2026-09-07';

type SupaError = { code: string; message: string };
type Row = Record<string, unknown> & { id: string; food_name: string; date: string; meal_type: string };

/**
 * Servidor `food_log` simulado con semántica de filtro real: `select`
 * filtra el array por TODOS los `.eq()` acumulados (sirve tanto para el
 * SELECT de origen de copyEntries — sin `.order()` — como para el de
 * fetchEntries — con `.order()`); `upsert`/`delete` mutan el mismo array
 * por `id`, igual que el PK real. Los fallos se controlan por `food_name`
 * (estable y elegido por el test), nunca por `id` (generado dentro de
 * copyEntries, imposible de predecir desde fuera).
 */
function mockFoodLogServer() {
  let rows: Row[] = [];
  const upsertOverrides = new Map<string, { error: SupaError } | 'hang'>();
  const deleteOverrides = new Map<string, { error: SupaError } | 'hang'>();
  const pendingUpserts: Array<() => void> = [];
  const pendingDeletes: Array<() => void> = [];
  const upsertCalls: string[] = [];
  let selectCallCount = 0;

  /** El SELECT es un objeto encadenable (cualquier número de `.eq()`/`.order()`)
   *  y a la vez "thenable" — `await` funciona sin una llamada terminal, para
   *  soportar tanto `select().eq().eq()` (copyEntries) como
   *  `select().eq().eq().order()` (fetchEntries) con el mismo mock. */
  function makeSelectBuilder() {
    const filters: Record<string, unknown> = {};
    const chain = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      order() {
        return chain;
      },
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        selectCallCount++;
        const data = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        resolve({ data, error: null });
      },
    };
    return chain;
  }

  mockFrom.mockImplementation(() => ({
    select: () => makeSelectBuilder(),
    upsert: (payload: Row) => {
      upsertCalls.push(payload.id);
      const override = upsertOverrides.get(payload.food_name);
      if (override === 'hang') {
        return new Promise((resolve) => {
          pendingUpserts.push(() => {
            rows = rows.filter((r) => r.id !== payload.id).concat(payload);
            resolve({ error: null });
          });
        });
      }
      if (override) return Promise.resolve(override);
      rows = rows.filter((r) => r.id !== payload.id).concat(payload);
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      eq: (_col: string, id: string) => {
        const row = rows.find((r) => r.id === id);
        const override = row ? deleteOverrides.get(row.food_name) : undefined;
        if (override === 'hang') {
          return new Promise((resolve) => {
            pendingDeletes.push(() => {
              rows = rows.filter((r) => r.id !== id);
              resolve({ error: null });
            });
          });
        }
        if (override) return Promise.resolve(override);
        rows = rows.filter((r) => r.id !== id);
        return Promise.resolve({ error: null });
      },
    }),
  }));

  return {
    rows: () => rows,
    seed: (r: Row) => rows.push(r),
    upsertOverrides,
    deleteOverrides,
    upsertCalls,
    getSelectCallCount: () => selectCallCount,
    resolveNextUpsert: () => pendingUpserts.shift()?.(),
    resolveNextDelete: () => pendingDeletes.shift()?.(),
  };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ error: null });
  mockReportError.mockReset();
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, diaryStore };
}

function sourceRow(id: string, foodName: string, over: Partial<Row> = {}): Row {
  return {
    id,
    user_id: USER_ID,
    date: YESTERDAY,
    meal_type: 'lunch',
    food_name: foodName,
    barcode: null,
    brand: null,
    serving_size_g: 100,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sugar_g: 1,
    saturated_fat_g: 1,
    sodium_mg: 50,
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
    created_at: '2026-09-06T12:00:00.000Z',
    updated_at: '2026-09-06T12:00:00.000Z',
    ...over,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('diaryStore.copyDayEntries/copyMealEntries — Diseño 1 (auditoría del Diario, Bugs D y E)', () => {
  it('1. online: mismo número de entradas y mismo contenido que hoy', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));
    server.seed(sourceRow('src-2', 'Garbanzos'));

    const { count, error } = await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);

    expect(error).toBeNull();
    expect(count).toBe(2);
    const local = await db.mirrorList<FoodLogEntry>('food_log', USER_ID, TODAY);
    expect(local.map((r) => r.payload.food_name).sort()).toEqual(['Garbanzos', 'Lentejas']);
    expect(local.every((r) => r.synced)).toBe(true);
    // Los ids son nuevos, distintos de los de origen.
    expect(local.map((r) => r.id)).not.toContain('src-1');
    expect(local.map((r) => r.id)).not.toContain('src-2');
    // El "servidor" también tiene las copias.
    expect(server.rows().filter((r) => r.date === TODAY)).toHaveLength(2);
  });

  it('2. offline: las copias quedan en SQLite como synced=0, sin mostrar error', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));
    server.upsertOverrides.set('Lentejas', { error: { code: '', message: 'Network request failed' } });

    const { count, error } = await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);

    expect(count).toBe(1); // se registró localmente pese al fallo de red
    expect(error).toBeNull(); // fallo transitorio: no se muestra como error
    const pending = await db.mirrorPending<FoodLogEntry>('food_log', USER_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.food_name).toBe('Lentejas');
  });

  it('3. flushPending posterior sincroniza las copias que quedaron pendientes', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));
    server.upsertOverrides.set('Lentejas', { error: { code: '', message: 'Network request failed' } });

    await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(1);

    server.upsertOverrides.delete('Lentejas'); // "vuelve la conexión"
    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
    expect(server.rows().filter((r) => r.date === TODAY)).toHaveLength(1);
  });

  it('4. timeout ambiguo tras aceptación remota + flush posterior → no duplica', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));

    // El upsert "acepta" la fila en el servidor (se añade a rows) pero el
    // cliente lo ve como un fallo de red — exactamente un timeout tras
    // aceptación: el servidor ya la tiene, addEntry cree que falló.
    let upsertAttempts = 0;
    mockFrom.mockImplementation(() => ({
      upsert: (payload: Row) => {
        upsertAttempts++;
        const already = server.rows().some((r) => r.id === payload.id);
        if (!already) {
          // Simula la mutación real del array del servidor sin pasar por
          // el helper (para no reintroducir el override de 'Lentejas').
          (server as unknown as { rows: () => Row[] }).rows().push(payload);
        }
        return Promise.resolve({ error: { code: '', message: 'Network request failed' } });
      },
      select: () => ({
        eq: function (this: { _f: Record<string, unknown> }, c: string, v: unknown) {
          this._f = { ...(this._f ?? {}), [c]: v };
          return this;
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: server.rows().filter((r) => r.user_id === USER_ID && r.date === YESTERDAY), error: null });
        },
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));

    await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);
    expect(upsertAttempts).toBe(1);
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(1);
    expect(server.rows().filter((r) => r.date === TODAY)).toHaveLength(1); // el servidor ya la tenía

    // Ahora sí, un flushPending que consigue confirmar (segundo intento).
    mockFrom.mockImplementation(() => ({
      upsert: (payload: Row) => {
        upsertAttempts++;
        server.rows().splice(
          0,
          server.rows().length,
          ...server.rows().filter((r) => r.id !== payload.id),
          payload
        );
        return Promise.resolve({ error: null });
      },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));
    await diaryStore.useDiaryStore.getState().flushPending(USER_ID);

    expect(upsertAttempts).toBe(2); // dos intentos por el MISMO id...
    expect(server.rows().filter((r) => r.date === TODAY)).toHaveLength(1); // ...pero una sola fila: no duplicó
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
  });

  it('5. fallo no-transitorio de una entrada intermedia → las demás se procesan igual, ninguna se pierde', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));
    server.seed(sourceRow('src-2', 'Garbanzos')); // la del medio, la que fallará
    server.seed(sourceRow('src-3', 'Tofu'));
    server.upsertOverrides.set('Garbanzos', { error: { code: '42501', message: 'permission denied' } });

    const { count, error } = await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);

    expect(count).toBe(3); // las tres se registraron localmente
    expect(error).not.toBeNull(); // aviso agregado, traducido (nunca "permission denied" crudo)
    expect(error).not.toMatch(/permission denied/);

    const local = await db.mirrorList<FoodLogEntry>('food_log', USER_ID, TODAY);
    expect(local.map((r) => r.payload.food_name).sort()).toEqual(['Garbanzos', 'Lentejas', 'Tofu']);

    const pending = await db.mirrorPending<FoodLogEntry>('food_log', USER_ID);
    expect(pending.map((r) => r.payload.food_name)).toEqual(['Garbanzos']); // sólo la fallida queda pendiente
    expect(server.rows().filter((r) => r.date === TODAY).map((r) => r.food_name).sort()).toEqual(['Lentejas', 'Tofu']);
  });

  it('6. una segunda pulsación deliberada genera un nuevo lote con ids nuevos (no deduplica)', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));

    const first = await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);
    const second = await diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);

    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
    const local = await db.mirrorList<FoodLogEntry>('food_log', USER_ID, TODAY);
    expect(local).toHaveLength(2); // dos copias distintas, no una sobreescribiendo a la otra
    expect(new Set(local.map((r) => r.id)).size).toBe(2); // ids distintos
  });

  it('7. fetchEntries concurrente sobre el día destino no hace desaparecer ni resucitar copias', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));
    server.upsertOverrides.set('Lentejas', 'hang');

    // No se asume qué operación gana el turno del lock primero (es un
    // detalle de implementación no garantizado: copyEntries hace su propio
    // SELECT de origen antes de llegar a addEntry, así que el orden real
    // depende del número exacto de microtasks de cada camino) — lo que
    // importa, y lo único que se verifica, es que el resultado final es
    // correcto pase lo que pase.
    const copyPromise = diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, TODAY);
    await flushMicrotasks();

    server.resolveNextUpsert(); // deja avanzar el upsert "en vuelo" de la copia, la tenga quien la tenga
    await Promise.all([copyPromise, fetchPromise]);

    const visible = await db.mirrorList<FoodLogEntry>('food_log', USER_ID, TODAY);
    expect(visible.map((r) => r.payload.food_name)).toEqual(['Lentejas']); // no desapareció
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0);
  });

  it('8. doble tap a nivel de store: dos llamadas casi simultáneas a copyDayEntries no interfieren entre sí y cada una respeta su propio resultado', async () => {
    // La deduplicación de la pulsación física vive en la UI
    // (DiaryScreen.copyEntries.test.tsx) — aquí sólo se confirma que, si
    // ocurrieran dos llamadas reales al store, cada una completa con
    // normalidad sin pisarse (secuencial dentro de cada una, coordinado por
    // withFoodLogLock frente a la otra).
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();
    server.seed(sourceRow('src-1', 'Lentejas'));

    const [r1, r2] = await Promise.all([
      diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY),
      diaryStore.useDiaryStore.getState().copyDayEntries(USER_ID, YESTERDAY, TODAY),
    ]);

    expect(r1.count).toBe(1);
    expect(r2.count).toBe(1);
    const local = await db.mirrorList<FoodLogEntry>('food_log', USER_ID, TODAY);
    expect(local).toHaveLength(2); // dos intenciones de copiar → dos copias, cada una íntegra
  });

  it('9. regresión: un alta normal y una tombstone siguen comportándose igual con el nuevo mock de servidor', async () => {
    const { db, diaryStore } = freshModules();
    const server = mockFoodLogServer();

    // Alta normal, sin relación con copyEntries.
    const { error: addErr } = await diaryStore.useDiaryStore.getState().addEntry({
      id: 'manual-1',
      user_id: USER_ID,
      date: TODAY,
      meal_type: 'dinner',
      food_name: 'Arroz',
      barcode: null,
      brand: null,
      serving_size_g: 100,
      calories: 130,
      protein_g: 3,
      carbs_g: 28,
      fat_g: 0.3,
      fiber_g: 0.4,
      sugar_g: 0,
      saturated_fat_g: 0,
      sodium_mg: 1,
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
      source: 'manual',
      source_ref: null,
      is_vegan: true,
      image_url: null,
    });
    expect(addErr).toBeNull();
    expect(server.rows().some((r) => r.id === 'manual-1')).toBe(true);

    // Tombstone: se sincroniza, se borra offline, y un fetchEntries
    // concurrente con una instantánea obsoleta no la resucita (P0 ya
    // cerrado, sin tocar — se reproduce aquí sólo para confirmar que el
    // nuevo mock de servidor no cambia este comportamiento).
    server.seed(sourceRow('tomb-1', 'Tofu viejo', { date: TODAY }));
    await db.mirrorUpsert('food_log', { id: 'tomb-1', user_id: USER_ID, date: TODAY, payload: sourceRow('tomb-1', 'Tofu viejo', { date: TODAY }) }, true);
    server.deleteOverrides.set('Tofu viejo', 'hang');

    const deletePromise = diaryStore.useDiaryStore.getState().deleteEntry('tomb-1');
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, TODAY);
    await flushMicrotasks();
    server.resolveNextDelete();
    await flushMicrotasks();
    // El select de fetchEntries pudo haber quedado a la espera del lock;
    // como el delete real nunca resuelve por sí solo aquí (usamos 'hang'
    // sin red simulada), lo dejamos avanzar y comprobamos el resultado.
    await Promise.all([deletePromise, fetchPromise]);

    const visible = await db.mirrorList<FoodLogEntry>('food_log', USER_ID, TODAY);
    expect(visible.some((r) => r.id === 'tomb-1')).toBe(false);
  });
});
