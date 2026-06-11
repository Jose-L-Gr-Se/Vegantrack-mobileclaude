/**
 * Persistencia local con SQLite (expo-sqlite).
 *
 * Estrategia offline-first:
 *  - `food_log` y `weight_logs` son espejos locales de las tablas Supabase.
 *    Las escrituras se aplican primero aquí (synced=0) y se intentan subir;
 *    `flushPending()` reintenta lo pendiente al arrancar / recuperar foco.
 *  - `off_cache` cachea productos de OpenFoodFacts por barcode (TTL 7 días),
 *    sustituyendo a la tabla `food_cache` de Supabase que usa la PWA.
 *  - `kv` guarda blobs JSON (overrides, últimas listas remotas) para que la
 *    app pueda mostrar datos sin conexión.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'vegantrack.db';
const SCHEMA_VERSION = 1;

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    migrate(db);
  }
  return db;
}

function migrate(database: SQLite.SQLiteDatabase): void {
  const row = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  database.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS food_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log (user_id, date);
    CREATE INDEX IF NOT EXISTS idx_food_log_unsynced ON food_log (synced) WHERE synced = 0;

    CREATE TABLE IF NOT EXISTS weight_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      payload TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_logs (user_id, date);

    CREATE TABLE IF NOT EXISTS off_cache (
      barcode TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

// ── kv: caché JSON genérica ─────────────────────────────────────────────────

export async function kvSet(key: string, value: unknown): Promise<void> {
  await getDb().runAsync(
    'INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)',
    key,
    JSON.stringify(value),
    Date.now()
  );
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const row = await getDb().getFirstAsync<{ value: string }>(
    'SELECT value FROM kv WHERE key = ?',
    key
  );
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

// ── off_cache: productos OpenFoodFacts ──────────────────────────────────────

const OFF_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, como la PWA

export async function getCachedOffProduct(barcode: string): Promise<unknown | null> {
  const row = await getDb().getFirstAsync<{ data: string; fetched_at: number }>(
    'SELECT data, fetched_at FROM off_cache WHERE barcode = ?',
    barcode
  );
  if (!row) return null;
  if (Date.now() - row.fetched_at > OFF_CACHE_MAX_AGE_MS) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function cacheOffProduct(barcode: string, raw: unknown): Promise<void> {
  await getDb().runAsync(
    'INSERT OR REPLACE INTO off_cache (barcode, data, fetched_at) VALUES (?, ?, ?)',
    barcode,
    JSON.stringify(raw),
    Date.now()
  );
}

// ── Espejo genérico de filas remotas (food_log / weight_logs) ───────────────

export interface MirrorRow<T> {
  id: string;
  payload: T;
  synced: boolean;
  deleted: boolean;
}

type MirrorTable = 'food_log' | 'weight_logs';

export async function mirrorList<T>(
  table: MirrorTable,
  userId: string,
  date?: string
): Promise<MirrorRow<T>[]> {
  const sql = date
    ? `SELECT id, payload, synced, deleted FROM ${table} WHERE user_id = ? AND date = ? AND deleted = 0`
    : `SELECT id, payload, synced, deleted FROM ${table} WHERE user_id = ? AND deleted = 0`;
  const args = date ? [userId, date] : [userId];
  const rows = await getDb().getAllAsync<{ id: string; payload: string; synced: number; deleted: number }>(
    sql,
    ...args
  );
  return rows.map((r) => ({
    id: r.id,
    payload: JSON.parse(r.payload) as T,
    synced: r.synced === 1,
    deleted: r.deleted === 1,
  }));
}

export async function mirrorUpsert(
  table: MirrorTable,
  row: { id: string; user_id: string; date: string; meal_type?: string; payload: unknown },
  synced: boolean
): Promise<void> {
  if (table === 'food_log') {
    await getDb().runAsync(
      `INSERT OR REPLACE INTO food_log (id, user_id, date, meal_type, payload, synced, deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      row.id,
      row.user_id,
      row.date,
      row.meal_type ?? 'snack',
      JSON.stringify(row.payload),
      synced ? 1 : 0
    );
  } else {
    await getDb().runAsync(
      `INSERT OR REPLACE INTO weight_logs (id, user_id, date, payload, synced, deleted)
       VALUES (?, ?, ?, ?, ?, 0)`,
      row.id,
      row.user_id,
      row.date,
      JSON.stringify(row.payload),
      synced ? 1 : 0
    );
  }
}

export async function mirrorMarkSynced(table: MirrorTable, id: string): Promise<void> {
  await getDb().runAsync(`UPDATE ${table} SET synced = 1 WHERE id = ?`, id);
}

/** Marca para borrado (tombstone). Se elimina de verdad cuando el delete remoto confirma. */
export async function mirrorMarkDeleted(table: MirrorTable, id: string): Promise<void> {
  await getDb().runAsync(`UPDATE ${table} SET deleted = 1, synced = 0 WHERE id = ?`, id);
}

export async function mirrorRemove(table: MirrorTable, id: string): Promise<void> {
  await getDb().runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
}

/** Filas pendientes de sincronizar (creaciones y borrados offline). */
export async function mirrorPending<T>(
  table: MirrorTable,
  userId: string
): Promise<MirrorRow<T>[]> {
  const rows = await getDb().getAllAsync<{ id: string; payload: string; synced: number; deleted: number }>(
    `SELECT id, payload, synced, deleted FROM ${table} WHERE user_id = ? AND synced = 0`,
    userId
  );
  return rows.map((r) => ({
    id: r.id,
    payload: JSON.parse(r.payload) as T,
    synced: false,
    deleted: r.deleted === 1,
  }));
}

/**
 * Reemplaza el espejo de un día con los datos remotos (fuente de verdad),
 * conservando las filas locales aún no sincronizadas.
 */
export async function mirrorReplaceDay(
  table: MirrorTable,
  userId: string,
  date: string,
  remoteRows: { id: string; meal_type?: string; payload: unknown }[]
): Promise<void> {
  const database = getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `DELETE FROM ${table} WHERE user_id = ? AND date = ? AND synced = 1`,
      userId,
      date
    );
    for (const r of remoteRows) {
      await mirrorUpsert(table, { id: r.id, user_id: userId, date, meal_type: r.meal_type, payload: r.payload }, true);
    }
  });
}
