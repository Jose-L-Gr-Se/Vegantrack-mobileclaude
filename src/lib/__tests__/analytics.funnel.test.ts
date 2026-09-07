/**
 * Auditoría de instrumentación del funnel — `trackFirstFoodLoggedOnce`.
 *
 * SQLite real (mismo adaptador que el resto de tests de sync, respaldado por
 * better-sqlite3) para probar la persistencia de verdad vía `kv`, el mismo
 * mecanismo que ya usa `last_user_id` en `authStore.ts` — no un flag en
 * memoria, que dispararía "primera vez" en cada sesión nueva.
 */
jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

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

beforeEach(() => {
  jest.resetModules();
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  mockInsert.mockReset().mockResolvedValue({ error: null });
});

describe('trackFirstFoodLoggedOnce', () => {
  it('la primera vez inserta el evento first_food_logged', async () => {
    const { trackFirstFoodLoggedOnce } = freshAnalytics();
    await trackFirstFoodLoggedOnce('user-1');
    // `track()` es fire-and-forget: da tiempo a que su promesa interna corra.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'first_food_logged', user_id: 'user-1' })
    );
  });

  it('una segunda llamada para el MISMO usuario no vuelve a insertar', async () => {
    const { trackFirstFoodLoggedOnce } = freshAnalytics();
    await trackFirstFoodLoggedOnce('user-1');
    await new Promise((r) => setTimeout(r, 0));
    mockInsert.mockClear();

    await trackFirstFoodLoggedOnce('user-1');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('usuarios distintos tienen flags independientes (el de uno no bloquea al del otro)', async () => {
    const { trackFirstFoodLoggedOnce } = freshAnalytics();
    await trackFirstFoodLoggedOnce('user-1');
    await new Promise((r) => setTimeout(r, 0));
    mockInsert.mockClear();

    // Sesión activa cambiada a user-2 (como ocurriría tras un logout/login
    // real) — el flag local se indexa por el userId que se le pasa a
    // `trackFirstFoodLoggedOnce`, no por la sesión de `track()`.
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } } });
    await trackFirstFoodLoggedOnce('user-2');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'first_food_logged', user_id: 'user-2' })
    );
  });
});
