/**
 * Fiabilidad de `first_food_logged` — antes, `trackFirstFoodLoggedOnce()`
 * marcaba el kv local (`first_food_logged_tracked:<userId>`) ANTES de saber
 * si `track()` había insertado el evento de verdad. Si la primera comida se
 * registraba offline, la comida quedaba guardada pero el evento se perdía
 * para siempre (el kv ya decía "hecho", así que nunca se reintentaba).
 *
 * Este archivo cubre el arreglo: el kv sólo se confirma con un insert real;
 * un fallo deja la puerta abierta a que una llamada posterior reintente; dos
 * llamadas concurrentes para el mismo usuario nunca duplican el evento; y el
 * envío en sí sigue sin bloquear a quien llama (`diaryStore.addEntry`), que
 * es justo lo que evita que este arreglo convierta el guardado offline-first
 * en una espera de red.
 *
 * Mismo arnés que `analytics.funnel.test.ts`/`analytics.appOpen.test.ts`:
 * SQLite real vía el adaptador de test (kv de verdad, no un mock), Supabase
 * simulado a nivel de `getSession`/`insert`.
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

/** `track()` sigue siendo fire-and-forget desde `trackFirstFoodLoggedOnce`
 * (ver nota en el propio código): da tiempo a que su promesa interna corra. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  jest.resetModules();
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  mockInsert.mockReset().mockResolvedValue({ error: null });
});

describe('track() — comunica si el insert tuvo éxito', () => {
  it('insert correcto devuelve true', async () => {
    const { track } = freshAnalytics();
    await expect(track('first_food_logged')).resolves.toBe(true);
  });

  it('insert con error de Postgrest devuelve false (sin lanzar)', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'permission denied' } });
    const { track } = freshAnalytics();
    await expect(track('first_food_logged')).resolves.toBe(false);
  });

  it('sin sesión (userId ausente) devuelve false y no llega a intentar el insert', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { track } = freshAnalytics();
    await expect(track('first_food_logged')).resolves.toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('trackFirstFoodLoggedOnce — el hito sólo se confirma con un insert real', () => {
  it('insert correcto → marca el hito en el kv local', async () => {
    const { trackFirstFoodLoggedOnce } = freshAnalytics();
    await trackFirstFoodLoggedOnce('user-1');
    await flush();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'first_food_logged', user_id: 'user-1' })
    );
    // Confirmado de verdad: una segunda llamada ya no vuelve a insertar.
    mockInsert.mockClear();
    await trackFirstFoodLoggedOnce('user-1');
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('insert fallido (p. ej. sin conexión) → NO marca el hito', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'Network request failed' } });
    const { trackFirstFoodLoggedOnce } = freshAnalytics();

    await trackFirstFoodLoggedOnce('user-1');
    await flush();

    expect(mockInsert).toHaveBeenCalledTimes(1); // se intentó...
    // ...pero como falló, el hito no debe quedar confirmado: lo comprueba el
    // siguiente test (una llamada posterior puede reintentar), que es la
    // única forma observable de verificar "no se marcó" sin tocar el kv a
    // mano desde el test.
  });

  it('fallo offline → una acción posterior (nueva llamada) puede reintentarlo, y esta vez si hay red, se confirma', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'Network request failed' } });
    const { trackFirstFoodLoggedOnce } = freshAnalytics();

    // 1ª comida: se pierde la conexión justo al mandar el evento.
    const firstAttempt = await trackFirstFoodLoggedOnce('user-1');
    await flush();
    expect(firstAttempt).toBe(true); // localmente, a esta llamada le tocaba el hito
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // 2ª comida, ya con red: una llamada normal y posterior (no concurrente)
    // vuelve a intentarlo desde cero, porque el kv nunca llegó a confirmarse.
    mockInsert.mockResolvedValue({ error: null });
    const secondAttempt = await trackFirstFoodLoggedOnce('user-1');
    await flush();

    expect(secondAttempt).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(2);

    // Ahora sí queda confirmado: una tercera llamada no vuelve a insertar.
    mockInsert.mockClear();
    await trackFirstFoodLoggedOnce('user-1');
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('dos llamadas concurrentes para el mismo usuario → como máximo un first_food_logged', async () => {
    const { trackFirstFoodLoggedOnce } = freshAnalytics();

    const [resultA, resultB] = await Promise.all([
      trackFirstFoodLoggedOnce('user-1'),
      trackFirstFoodLoggedOnce('user-1'),
    ]);
    await flush();

    // Sólo una de las dos "gana" la carrera localmente...
    expect([resultA, resultB].filter(Boolean)).toHaveLength(1);
    // ...y sólo se dispara un insert, nunca dos, aunque ambas llamadas se
    // hayan resuelto casi al mismo tiempo.
    const firstFoodLoggedInserts = mockInsert.mock.calls.filter(
      ([row]) => row.event === 'first_food_logged'
    );
    expect(firstFoodLoggedInserts).toHaveLength(1);
  });

  it('tres llamadas concurrentes → sigue habiendo como máximo un insert', async () => {
    const { trackFirstFoodLoggedOnce } = freshAnalytics();

    const results = await Promise.all([
      trackFirstFoodLoggedOnce('user-1'),
      trackFirstFoodLoggedOnce('user-1'),
      trackFirstFoodLoggedOnce('user-1'),
    ]);
    await flush();

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('el envío no bloquea a quien llama: trackFirstFoodLoggedOnce resuelve sin esperar a que el insert termine', async () => {
    // El insert nunca se resuelve durante este test — si `await
    // trackFirstFoodLoggedOnce(...)` esperase a la red, esta promesa no
    // resolvería jamás y el test haría timeout.
    let resolveInsert: (v: { error: null }) => void = () => {};
    mockInsert.mockImplementation(
      () => new Promise((resolve) => { resolveInsert = resolve; })
    );
    const { trackFirstFoodLoggedOnce } = freshAnalytics();

    const result = await trackFirstFoodLoggedOnce('user-1');

    expect(result).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1); // el envío ya se lanzó...
    resolveInsert({ error: null }); // ...pero seguía sin terminar cuando `trackFirstFoodLoggedOnce` ya había resuelto.
  });
});
