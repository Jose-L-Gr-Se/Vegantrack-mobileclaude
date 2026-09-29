/**
 * Auditoría del Diario — cierre del Bug B para `deleteEntry`: reproduce la
 * resurrección de una fila YA BORRADA cuando `deleteEntry()` compite con un
 * `fetchEntries()` concurrente cuya instantánea remota quedó obsoleta, y
 * demuestra que `withFoodLogLock` (ya usado por `flushPending`/
 * `fetchEntries` entre sí) también coordina `deleteEntry`.
 *
 * Mecanismo del bug (sin el fix): fetchEntries emite su SELECT ANTES de que
 * el DELETE de deleteEntry confirme en el servidor → su instantánea todavía
 * incluye la fila. deleteEntry confirma y hace mirrorRemove: la fila ya no
 * existe en absoluto en SQLite (ni siquiera como tombstone). Cuando
 * mirrorReplaceDay (de ese fetchEntries) reinserta su instantánea obsoleta,
 * el guard de mirrorUpsert no tiene nada que proteger (`existing` es
 * undefined) y la fila borrada reaparece.
 *
 * Mismo enfoque que diaryStore.foodLogRace.test.ts (servidor simulado con
 * un array mutable + delete/select controlables por el test), aplicado
 * aquí a deleteEntry en vez de a flushPending.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { NewFoodLogEntry } from '@/utils/foodEntry';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));
// diaryStore.ts lee el perfil de authStore.getState() para el texto del
// recordatorio contextual (P1 de retención) — authStore importa
// purchasesStore -> react-native-purchases, un paquete con ESM que Jest no
// transforma sin mock.
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null, fetchProfile: jest.fn() }) } }));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

const USER_ID = 'user-1';
const DATE = '2026-09-07';

function foodPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    calories: 300,
    created_at: '2026-09-07T00:00:00.000Z',
    updated_at: '2026-09-07T00:00:00.000Z',
    ...over,
  };
}

/** Entry completa (NewFoodLogEntry) para llamar a addEntry() directamente —
 *  foodPayload() de arriba sólo sirve para las filas del "servidor" simulado. */
function fullEntry(id: string, over: Partial<NewFoodLogEntry> = {}): NewFoodLogEntry {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
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
    ...over,
  } as NewFoodLogEntry;
}

/**
 * Mock de `food_log` respaldado por un array mutable ("servidor"). El
 * `delete` sólo quita la fila del array cuando el test llama a
 * `resolveNextDelete` (simula la latencia real); el `select` lee el array
 * en ese momento pero tampoco se resuelve hasta `resolveNextSelect` — así
 * se demuestra bloqueo real (contadores de llamadas), no orden casual.
 */
function mockFoodLogServer(options: { deleteSucceeds?: boolean } = {}) {
  const deleteSucceeds = options.deleteSucceeds ?? true;
  const serverRows: ReturnType<typeof foodPayload>[] = [];
  const deleteCalls: string[] = [];
  let selectCallCount = 0;
  const pendingDeletes: Array<() => void> = [];
  const pendingSelects: Array<() => void> = [];

  mockFrom.mockImplementation(() => ({
    upsert: (payload: ReturnType<typeof foodPayload>) => {
      serverRows.push(payload);
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      eq: (_col: string, id: string) => {
        deleteCalls.push(id);
        if (!deleteSucceeds) {
          return Promise.resolve({ error: { code: '', message: 'Network request failed' } });
        }
        return new Promise((resolve) => {
          pendingDeletes.push(() => {
            const idx = serverRows.findIndex((r) => r.id === id);
            if (idx >= 0) serverRows.splice(idx, 1);
            resolve({ error: null });
          });
        });
      },
    }),
    select: () => {
      selectCallCount++;
      return {
        eq: () => ({
          eq: () => ({
            order: () =>
              new Promise((resolve) => {
                pendingSelects.push(() => {
                  resolve({
                    data: serverRows.filter((r) => r.user_id === USER_ID && r.date === DATE),
                    error: null,
                  });
                });
              }),
          }),
        }),
      };
    },
  }));

  return {
    serverRows,
    deleteCalls,
    getSelectCallCount: () => selectCallCount,
    resolveNextDelete: () => pendingDeletes.shift()?.(),
    resolveNextSelect: () => pendingSelects.shift()?.(),
  };
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, diaryStore };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('diaryStore — deleteEntry vs fetchEntries: la fila borrada no debe resucitar (auditoría del Diario, Bug B)', () => {
  it('5. deleteEntry adquiere el lock primero: fetchEntries espera, y su propio SELECT ya no ve la fila borrada — no resucita', async () => {
    const { db, diaryStore } = freshModules();
    const { serverRows, resolveNextDelete, resolveNextSelect, getSelectCallCount } = mockFoodLogServer();
    const id = 'entry-del-1';
    serverRows.push(foodPayload(id)); // la fila ya existe en el "servidor"
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);

    // Disparo conjunto, igual que un usuario borrando justo cuando la
    // pantalla también se refresca (foco / pull-to-refresh).
    const deletePromise = diaryStore.useDiaryStore.getState().deleteEntry(id);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks();

    // Prueba de bloqueo real: fetchEntries todavía no ha podido emitir su
    // SELECT — sigue esperando su turno del lock.
    expect(getSelectCallCount()).toBe(0);

    resolveNextDelete(); // el DELETE "llega" al servidor: la fila desaparece de serverRows
    await flushMicrotasks(); // deja que fetchEntries adquiera el lock y llame a su propio select()
    resolveNextSelect();
    await Promise.all([deletePromise, fetchPromise]);

    expect(getSelectCallCount()).toBe(1); // ahora sí, y ya sin la fila en el "servidor"
    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(false); // no resucitó
    expect(await db.mirrorPending('food_log', USER_ID)).toHaveLength(0); // tampoco quedó como tombstone huérfana
  });

  it('6. regresión de tombstones: si el delete falla (red), la tombstone sigue protegida frente a un fetchEntries concurrente que SÍ trae la fila de vuelta', async () => {
    const { db, diaryStore } = freshModules();
    // El DELETE remoto falla — la fila sigue "viva" en el servidor.
    const { serverRows, resolveNextSelect } = mockFoodLogServer({ deleteSucceeds: false });
    const id = 'entry-del-2';
    serverRows.push(foodPayload(id));
    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);

    const deletePromise = diaryStore.useDiaryStore.getState().deleteEntry(id);
    const fetchPromise = diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flushMicrotasks(); // deleteEntry (falla al instante) termina y suelta el lock
    resolveNextSelect();
    const [{ error: deleteError }] = await Promise.all([deletePromise, fetchPromise]);

    expect(deleteError).toBeNull(); // fallo de red, no se muestra como error

    // El guard de tombstones de mirrorUpsert (P0 ya cerrado, sin tocar)
    // sigue protegiéndola pese a que el SELECT la trajo de vuelta.
    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(false);
    const pending = await db.mirrorPending('food_log', USER_ID);
    expect(pending).toEqual([expect.objectContaining({ id, deleted: true })]);
  });

  it('7. editar y borrar la misma entrada casi a la vez: la confirmación tardía de la edición no debe resucitar el borrado tras un fetchEntries posterior (auditoría del borrado)', async () => {
    // Escenario: el usuario edita una entrada (ProductDetailSheet.commit()
    // en isEdit) y, antes de que el upsert remoto de esa edición confirme,
    // borra la MISMA entrada. Si el DELETE remoto falla de forma transitoria
    // justo después, mirrorMarkSynced() de la edición (que llega después del
    // mirrorMarkDeleted() del borrado) no debe reactivar la fila —
    // debe seguir siendo una tombstone synced=0, no synced=1.
    const { db, diaryStore } = freshModules();
    const id = 'entry-del-3';
    const serverRows: ReturnType<typeof foodPayload>[] = [foodPayload(id, { calories: 300 })];
    const pendingUpserts: Array<() => void> = [];

    mockFrom.mockImplementation(() => ({
      upsert: (payload: { id: string; calories: number }) =>
        new Promise((resolve) => {
          pendingUpserts.push(() => {
            const idx = serverRows.findIndex((r) => r.id === payload.id);
            if (idx >= 0) serverRows[idx] = { ...serverRows[idx], ...payload };
            else serverRows.push(payload as ReturnType<typeof foodPayload>);
            resolve({ error: null });
          });
        }),
      delete: () => ({
        // El borrado remoto falla de forma transitoria (p. ej. la conexión
        // se corta justo después de que la edición consiguiera confirmar).
        eq: () => Promise.resolve({ error: { code: '', message: 'Network request failed' } }),
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({
                data: serverRows.filter((r) => r.user_id === USER_ID && r.date === DATE),
                error: null,
              }),
          }),
        }),
      }),
    }));

    await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id, { calories: 300 }) }, true);

    // "Editar": mismo id, contenido distinto. Su escritura LOCAL
    // (mirrorUpsert) es lo primero que hace addEntry() y no depende de red,
    // así que en la práctica ya ha terminado antes de que un segundo toque
    // humano llegue a disparar deleteEntry() — se dejan pasar los
    // microtasks para reflejar exactamente ese orden real, en vez de
    // invocar ambas funciones en el mismo tick (que ejercitaría una carrera
    // local distinta, de ventana muchísimo más estrecha, entre
    // mirrorUpsert y mirrorMarkDeleted). Su upsert REMOTO, en cambio, sí
    // queda "en vuelo" hasta que el test lo resuelva más abajo — es esa
    // espera de red la que da tiempo real a que el usuario pulse "Eliminar".
    const editPromise = diaryStore.useDiaryStore.getState().addEntry(fullEntry(id, { calories: 450 }));
    await flushMicrotasks();
    expect(await db.mirrorPending('food_log', USER_ID)).toEqual([expect.objectContaining({ id, deleted: false })]);

    // Ahora, con la escritura local de la edición ya asentada, el usuario
    // borra la MISMA entrada — deleteEntry() marca la tombstone de
    // inmediato (no espera al lock).
    const deletePromise = diaryStore.useDiaryStore.getState().deleteEntry(id);
    await flushMicrotasks();
    expect(await db.mirrorPending('food_log', USER_ID)).toEqual([expect.objectContaining({ id, deleted: true })]);

    // Ahora "llega" la confirmación remota de la edición, tarde, después de
    // la tombstone — dispara mirrorMarkSynced().
    pendingUpserts.shift()?.();
    const [, { error: deleteError }] = await Promise.all([editPromise, deletePromise]);
    expect(deleteError).toBeNull(); // el fallo del DELETE es transitorio: no se muestra como error

    // La tombstone debe seguir intacta y pendiente de reintento — no
    // "reactivada" a synced=1 por la edición que confirmó después.
    const pendingAfterRace = await db.mirrorPending<ReturnType<typeof foodPayload>>('food_log', USER_ID);
    expect(pendingAfterRace).toEqual([expect.objectContaining({ id, deleted: true })]);
    expect(pendingAfterRace[0].synced).toBe(false);

    // Un fetchEntries posterior (el "servidor" todavía tiene la fila, porque
    // el DELETE real nunca llegó a aplicarse ahí) no debe resucitarla: sin
    // el fix, el guard de mirrorUpsert (deleted=1 AND synced=0) ya no
    // protegía esta fila porque había quedado synced=1.
    await diaryStore.useDiaryStore.getState().fetchEntries(USER_ID, DATE);

    const visible = await db.mirrorList('food_log', USER_ID, DATE);
    expect(visible.some((r) => r.id === id)).toBe(false);
    const pendingAfterFetch = await db.mirrorPending('food_log', USER_ID);
    expect(pendingAfterFetch).toEqual([expect.objectContaining({ id, deleted: true })]);
  });
});
