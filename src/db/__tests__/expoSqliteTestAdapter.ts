/**
 * Adaptador de test: implementa la MISMA superficie de `expo-sqlite` que usa
 * `src/db/database.ts` (`openDatabaseSync`, `getFirstSync`, `execSync`,
 * `runAsync`, `getAllAsync`, `getFirstAsync`, `withTransactionAsync`), pero
 * respaldado por `better-sqlite3` — SQLite real, no un fake a mano.
 *
 * Con esto, las funciones exportadas de `database.ts` (`mirrorUpsert`,
 * `mirrorReplaceDay`, `mirrorMarkDeleted`, `mirrorPending`, ...) corren SIN
 * TOCAR — es SQLite de verdad ejecutando el SQL real de producción, sólo con
 * el motor nativo intercambiado. Este fichero NO reimplementa la lógica de
 * `mirrorUpsert`/`mirrorReplaceDay`: sólo traduce las llamadas de bajo nivel.
 *
 * Uso en un test:
 *   jest.mock('expo-sqlite', () => require('./expoSqliteTestAdapter'));
 *
 * Cada llamada a `openDatabaseSync` crea una base en memoria NUEVA (el
 * nombre se ignora a propósito) — combinado con `jest.resetModules()` antes
 * de cada test para que `database.ts` vuelva a evaluarse desde cero, esto
 * da aislamiento total entre tests sin necesitar ningún hook de "reset" en
 * el código de producción.
 */
import Database from 'better-sqlite3';

type SqlParam = string | number | null;

class ExpoSqliteTestAdapter {
  private readonly raw: Database.Database;

  constructor() {
    this.raw = new Database(':memory:');
  }

  getFirstSync<T>(sql: string): T | null {
    const row = this.raw.prepare(sql).get() as T | undefined;
    return row ?? null;
  }

  execSync(sql: string): void {
    this.raw.exec(sql);
  }

  async runAsync(
    sql: string,
    ...params: SqlParam[]
  ): Promise<{ changes: number; lastInsertRowId: number }> {
    const info = this.raw.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
  }

  async getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  async getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null> {
    const row = this.raw.prepare(sql).get(...params) as T | undefined;
    return row ?? null;
  }

  /**
   * better-sqlite3 exige que las transacciones envuelvan una función
   * SÍNCRONA (`db.transaction(fn)` no admite promesas) — así que aquí se
   * envuelve manualmente con BEGIN/COMMIT/ROLLBACK en vez de usar ese
   * helper. Los métodos de arriba son async sólo por interfaz (para calzar
   * con la de expo-sqlite): por debajo son síncronos, así que el resultado
   * observable es el mismo que una transacción real.
   */
  async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
    this.raw.exec('BEGIN');
    try {
      await callback();
      this.raw.exec('COMMIT');
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }
}

export function openDatabaseSync(_name: string): ExpoSqliteTestAdapter {
  return new ExpoSqliteTestAdapter();
}
