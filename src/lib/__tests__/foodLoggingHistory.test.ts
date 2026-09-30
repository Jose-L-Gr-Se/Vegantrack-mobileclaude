/**
 * Señal de producto `has_logged_food:<userId>` (`foodLoggingHistory`).
 *
 * El KV se simula con un `Map` del propio archivo de test, que sobrevive a
 * `jest.resetModules()`: recargar el módulo equivale a cerrar y reabrir la
 * app (se pierde la caché en memoria `markedThisSession`, el almacenamiento
 * persistente se conserva).
 */
const mockStore = new Map<string, string>();
let mockKvFails = false;

jest.mock('@/db/database', () => ({
  kvSet: async (key: string, value: unknown) => {
    if (mockKvFails) throw new Error('SQLITE_IOERR');
    mockStore.set(key, JSON.stringify(value));
  },
  kvGet: async (key: string) => {
    if (mockKvFails) throw new Error('SQLITE_IOERR');
    return mockStore.has(key) ? JSON.parse(mockStore.get(key)!) : null;
  },
}));

function reopenApp() {
  jest.resetModules();
  return require('@/lib/foodLoggingHistory') as typeof import('@/lib/foodLoggingHistory');
}

beforeEach(() => {
  mockStore.clear();
  mockKvFails = false;
});

describe('foodLoggingHistory', () => {
  it('sin marcar: false', async () => {
    const { hasLoggedFood } = reopenApp();
    await expect(hasLoggedFood('user-1')).resolves.toBe(false);
  });

  it('marcar → true, por usuario, con la clave de producto (no la de analítica)', async () => {
    const { markHasLoggedFood, hasLoggedFood } = reopenApp();
    await markHasLoggedFood('user-1');
    await expect(hasLoggedFood('user-1')).resolves.toBe(true);
    await expect(hasLoggedFood('user-2')).resolves.toBe(false);
    expect([...mockStore.keys()]).toEqual(['has_logged_food:user-1']);
  });

  it('cerrar y reabrir la app conserva la señal', async () => {
    await reopenApp().markHasLoggedFood('user-1');
    const reopened = reopenApp();
    await expect(reopened.hasLoggedFood('user-1')).resolves.toBe(true);
  });

  it('limpiar la borra, también tras reabrir, y permite volver a marcarla', async () => {
    const a = reopenApp();
    await a.markHasLoggedFood('user-1');
    await a.clearHasLoggedFood('user-1');
    await expect(a.hasLoggedFood('user-1')).resolves.toBe(false);
    await expect(reopenApp().hasLoggedFood('user-1')).resolves.toBe(false);
    // La caché en memoria también se limpia: un nuevo registro vuelve a escribir.
    await a.markHasLoggedFood('user-1');
    await expect(a.hasLoggedFood('user-1')).resolves.toBe(true);
  });

  it('limpiar un usuario no toca a otro', async () => {
    const m = reopenApp();
    await m.markHasLoggedFood('user-1');
    await m.markHasLoggedFood('user-2');
    await m.clearHasLoggedFood('user-1');
    await expect(m.hasLoggedFood('user-2')).resolves.toBe(true);
  });

  it('con SQLite fallando nunca lanza: marcar/limpiar son no-op y leer da false', async () => {
    const m = reopenApp();
    mockKvFails = true;
    await expect(m.markHasLoggedFood('user-1')).resolves.toBeUndefined();
    await expect(m.clearHasLoggedFood('user-1')).resolves.toBeUndefined();
    await expect(m.hasLoggedFood('user-1')).resolves.toBe(false);
  });

  it('una escritura fallida no queda cacheada como hecha: el siguiente registro la reintenta', async () => {
    const m = reopenApp();
    mockKvFails = true;
    await m.markHasLoggedFood('user-1');
    mockKvFails = false;
    await m.markHasLoggedFood('user-1');
    await expect(m.hasLoggedFood('user-1')).resolves.toBe(true);
  });
});
