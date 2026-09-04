/**
 * P0 de sincronización — resurrección de borrados offline (ver
 * docs de la re-auditoría, sección "mirrorReplaceDay").
 *
 * Usa SQLite real vía better-sqlite3 (`expoSqliteTestAdapter.ts`), no un
 * fake de SQL a mano: estas pruebas ejercitan las funciones exportadas de
 * `database.ts` tal cual, sin reimplementar su lógica.
 *
 * Aislamiento entre tests: `jest.resetModules()` en `beforeEach` fuerza a
 * que `database.ts` se re-evalúe desde cero en cada test, así que la
 * variable de caché `db` (module-level, no exportada) arranca en `null` y
 * `getDb()` crea una base en memoria nueva — sin necesitar ningún hook de
 * reset en el código de producción.
 */
import type * as DatabaseModule from '@/db/database';

jest.mock('expo-sqlite', () => require('./expoSqliteTestAdapter'));

function freshDb(): typeof DatabaseModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@/db/database') as typeof DatabaseModule;
}

const USER_ID = 'user-1';
const DATE = '2026-09-04';

function foodPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Lentejas',
    calories: 300,
    ...over,
  };
}

function weightPayload(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    weight_kg: 70,
    ...over,
  };
}

describe('mirrorUpsert respeta las tombstones locales (P0 sincronización)', () => {
  describe('TEST 1 — food_log: una tombstone no se resucita al recibir el mismo id por mirror', () => {
    it('la fila no reaparece y el borrado sigue pendiente tras mirrorReplaceDay', async () => {
      const db = freshDb();
      const id = 'entry-1';

      // A. Existe una entrada ya sincronizada (local == remoto)
      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, true);
      expect(await db.mirrorList('food_log', USER_ID, DATE)).toEqual([
        expect.objectContaining({ id, deleted: false, synced: true }),
      ]);

      // B. Se borra offline
      await db.mirrorMarkDeleted('food_log', id);

      // C. Confirmar: deleted=1 AND synced=0 (tombstone)
      const pendingBefore = await db.mirrorPending<ReturnType<typeof foodPayload>>('food_log', USER_ID);
      expect(pendingBefore).toEqual([expect.objectContaining({ id, deleted: true })]);

      // D. Una sincronización que todavía trae la misma fila desde remoto —
      //    exactamente lo que pasa si el DELETE nunca llegó a Supabase por
      //    falta de red (el escenario real del bug).
      await db.mirrorReplaceDay('food_log', USER_ID, DATE, [
        { id, meal_type: 'lunch', payload: foodPayload(id) },
      ]);

      // E. La fila no debe reaparecer como viva...
      const visibleAfter = await db.mirrorList('food_log', USER_ID, DATE);
      expect(visibleAfter.some((r) => r.id === id)).toBe(false);

      // ...la tombstone debe seguir existiendo tal cual...
      const pendingAfter = await db.mirrorPending<ReturnType<typeof foodPayload>>('food_log', USER_ID);
      expect(pendingAfter).toEqual([expect.objectContaining({ id, deleted: true })]);

      // ...y sigue pendiente de que flushPending() reintente el borrado.
      expect(pendingAfter.find((r) => r.id === id)?.synced).toBe(false);
    });
  });

  describe('TEST 2 — alta pendiente: sí converge normalmente a synced=1', () => {
    it('un synced=0/deleted=0 se actualiza a synced=1 cuando su id aparece en remoto, y deja de estar pendiente', async () => {
      const db = freshDb();
      const id = 'entry-2';

      // A. Alta pendiente: creada offline, aún no confirmada por el servidor
      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id) }, false);
      const pendingBefore = await db.mirrorPending('food_log', USER_ID);
      expect(pendingBefore).toEqual([expect.objectContaining({ id, deleted: false })]);

      // B. Mirror del mismo id desde remoto (p. ej. tras un insertRemote()
      //    que sí tuvo éxito, o una resincronización normal)
      await db.mirrorReplaceDay('food_log', USER_ID, DATE, [
        { id, meal_type: 'lunch', payload: foodPayload(id) },
      ]);

      // C. Converge: sigue visible...
      const visibleAfter = await db.mirrorList('food_log', USER_ID, DATE);
      expect(visibleAfter.some((r) => r.id === id)).toBe(true);

      // D. ...y ya NO queda atrapada como pendiente (el guard de tombstones
      //    no debe bloquear este caso, que es deleted=0).
      const pendingAfter = await db.mirrorPending('food_log', USER_ID);
      expect(pendingAfter.find((r) => r.id === id)).toBeUndefined();
    });
  });

  describe('TEST 3 — weight_logs: el mismo blindaje protege la otra tabla', () => {
    it('una tombstone de peso tampoco se resucita vía mirrorUpsert directo', async () => {
      const db = freshDb();
      const id = 'weight-1';

      // A. Peso ya sincronizado
      await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, true);

      // B. Borrado offline → tombstone
      await db.mirrorMarkDeleted('weight_logs', id);
      const pendingBefore = await db.mirrorPending('weight_logs', USER_ID);
      expect(pendingBefore).toEqual([expect.objectContaining({ id, deleted: true })]);

      // C. weightStore.fetchLogs() no pasa por mirrorReplaceDay: hace un
      //    mirrorUpsert directo por cada fila remota — se reproduce ese
      //    camino exacto, no el de food_log.
      await db.mirrorUpsert('weight_logs', { id, user_id: USER_ID, date: DATE, payload: weightPayload(id) }, true);

      // D. No debe reaparecer, y la tombstone debe seguir intacta.
      const visibleAfter = await db.mirrorList('weight_logs', USER_ID, DATE);
      expect(visibleAfter.some((r) => r.id === id)).toBe(false);

      const pendingAfter = await db.mirrorPending('weight_logs', USER_ID);
      expect(pendingAfter).toEqual([expect.objectContaining({ id, deleted: true })]);
    });
  });

  describe('TEST 4 — fila normal: el mirror remoto sin tombstone sigue funcionando', () => {
    it('una fila remota nueva (sin fila local previa) se hace upsert con normalidad', async () => {
      const db = freshDb();
      const id = 'entry-4';

      await db.mirrorReplaceDay('food_log', USER_ID, DATE, [
        { id, meal_type: 'dinner', payload: foodPayload(id, { meal_type: 'dinner' }) },
      ]);

      const visible = await db.mirrorList('food_log', USER_ID, DATE);
      expect(visible).toEqual([expect.objectContaining({ id, deleted: false, synced: true })]);
    });

    it('una fila remota que actualiza una fila local ya synced=1 se sigue reemplazando con normalidad', async () => {
      const db = freshDb();
      const id = 'entry-4b';

      await db.mirrorUpsert('food_log', { id, user_id: USER_ID, date: DATE, payload: foodPayload(id, { calories: 300 }) }, true);
      await db.mirrorReplaceDay('food_log', USER_ID, DATE, [
        { id, meal_type: 'lunch', payload: foodPayload(id, { calories: 450 }) },
      ]);

      const visible = await db.mirrorList<ReturnType<typeof foodPayload>>('food_log', USER_ID, DATE);
      expect(visible).toHaveLength(1);
      expect(visible[0].payload.calories).toBe(450);
    });
  });

  describe('TEST 5 — una tombstone de un id no bloquea el mirror de otro id', () => {
    it('la tombstone de A no impide que B se sincronice con normalidad', async () => {
      const db = freshDb();
      const idA = 'entry-A';
      const idB = 'entry-B';

      await db.mirrorUpsert('food_log', { id: idA, user_id: USER_ID, date: DATE, payload: foodPayload(idA) }, true);
      await db.mirrorMarkDeleted('food_log', idA);

      await db.mirrorReplaceDay('food_log', USER_ID, DATE, [
        { id: idA, meal_type: 'lunch', payload: foodPayload(idA) },
        { id: idB, meal_type: 'lunch', payload: foodPayload(idB) },
      ]);

      const visible = await db.mirrorList('food_log', USER_ID, DATE);
      expect(visible.map((r) => r.id)).toEqual([idB]);

      const pending = await db.mirrorPending('food_log', USER_ID);
      expect(pending.map((r) => r.id)).toEqual([idA]);
    });
  });
});
