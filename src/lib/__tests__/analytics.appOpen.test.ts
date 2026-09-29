/**
 * Auditoría de medición de sesiones/retención — `trackAppOpenOnce`.
 *
 * Antes era un flag en memoria (`let appOpenTracked`), reseteado sólo al
 * matar y reabrir el proceso: infravaloraba D7/D30 para cualquiera que
 * dejase la app en segundo plano varios días sin cerrarla del todo. Ahora
 * deduplica por usuario y DÍA NATURAL, persistido en SQLite real (mismo
 * adaptador que `analytics.funnel.test.ts`, respaldado por better-sqlite3),
 * así que sobrevive a reinicios del proceso, cambios de pestaña y ciclos de
 * segundo plano/primer plano dentro del mismo día.
 *
 * `todayISO()` se mockea para poder controlar "qué día es hoy" y simular un
 * cambio de día sin depender del reloj real de la máquina de test.
 */
jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

let mockToday = '2026-09-08';
jest.mock('@/utils/dates', () => ({
  ...jest.requireActual('@/utils/dates'),
  todayISO: () => mockToday,
}));

const mockGetSession = jest.fn();
const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
  },
}));

function freshAnalytics() {
  return require('@/lib/analytics') as typeof import('@/lib/analytics');
}

/** `track()` es fire-and-forget: da tiempo a que su promesa interna corra. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  jest.resetModules();
  mockToday = '2026-09-08';
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  mockInsert.mockReset().mockResolvedValue({ error: null });
});

describe('trackAppOpenOnce', () => {
  it('la primera apertura del día inserta app_open', async () => {
    const { trackAppOpenOnce } = freshAnalytics();
    await trackAppOpenOnce('user-1');
    await flush();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app_open', user_id: 'user-1' })
    );
  });

  it('dos aperturas el mismo día → un solo evento', async () => {
    const { trackAppOpenOnce } = freshAnalytics();
    await trackAppOpenOnce('user-1');
    await flush();
    mockInsert.mockClear();

    await trackAppOpenOnce('user-1');
    await flush();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('cambiar de pestaña/background/foreground el mismo día (varias llamadas seguidas) no duplica', async () => {
    const { trackAppOpenOnce } = freshAnalytics();
    await trackAppOpenOnce('user-1');
    await flush();
    mockInsert.mockClear();

    // Simula varios re-renders/reenfoques dentro del mismo día natural.
    await trackAppOpenOnce('user-1');
    await trackAppOpenOnce('user-1');
    await trackAppOpenOnce('user-1');
    await flush();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('abrir al día siguiente genera un nuevo evento', async () => {
    const { trackAppOpenOnce } = freshAnalytics();
    await trackAppOpenOnce('user-1');
    await flush();
    mockInsert.mockClear();

    mockToday = '2026-09-09';
    await trackAppOpenOnce('user-1');
    await flush();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app_open', user_id: 'user-1' })
    );
  });

  it('usuarios distintos tienen claves independientes (el de uno no bloquea al del otro, mismo día)', async () => {
    const { trackAppOpenOnce } = freshAnalytics();
    await trackAppOpenOnce('user-1');
    await flush();
    mockInsert.mockClear();

    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } } });
    await trackAppOpenOnce('user-2');
    await flush();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app_open', user_id: 'user-2' })
    );
  });

  it('sin sesión activa, no se registra ningún evento (y no se pierde la posibilidad de reintentar)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { trackAppOpenOnce } = freshAnalytics();

    await trackAppOpenOnce('user-1');
    await flush();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
