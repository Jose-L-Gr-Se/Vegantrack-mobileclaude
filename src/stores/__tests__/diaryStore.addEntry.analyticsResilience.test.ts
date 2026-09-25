/**
 * Fiabilidad de `first_food_logged` — integración real (sin mockear
 * `@/lib/analytics`, a diferencia de `diaryStore.firstFoodLogged.test.ts` y
 * `diaryStore.firstEntryReminderOffer.test.ts`): comprueba que un fallo real
 * al insertar el evento de analytics (p. ej. sin conexión) NUNCA convierte
 * un guardado local que sí funcionó en un `addEntry()` fallido o rechazado.
 * El mecanismo propio de `trackFirstFoodLoggedOnce` (confirmación gated por
 * éxito, reintento posterior, candado de concurrencia) ya está cubierto en
 * `analytics.firstFoodLoggedReliability.test.ts`; aquí sólo se prueba que
 * `addEntry` no depende de que ese insert tenga éxito.
 */
jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null }) } }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/notifications/reminders', () => ({
  getReminderHour: jest.fn().mockResolvedValue(null),
  getReminderOfferShown: jest.fn().mockResolvedValue(true), // ya mostrada: no interfiere con este test
  markReminderOfferShown: jest.fn().mockResolvedValue(undefined),
  onMealLogged: jest.fn().mockResolvedValue(undefined),
}));

const mockGetSession = jest.fn();
const mockAnalyticsInsert = jest.fn();
const mockFoodLogUpsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    from: (table: string) => {
      if (table === 'analytics_events') return { insert: (...args: unknown[]) => mockAnalyticsInsert(...args) };
      if (table === 'food_log') return { upsert: (...args: unknown[]) => mockFoodLogUpsert(...args) };
      throw new Error(`tabla inesperada en el mock: ${table}`);
    },
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

function freshModules() {
  jest.resetModules();
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
  mockAnalyticsInsert.mockReset();
  mockFoodLogUpsert.mockReset().mockResolvedValue({ error: null }); // la comida en sí siempre se guarda bien
  return require('@/stores/diaryStore') as typeof import('@/stores/diaryStore');
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

const USER_ID = 'user-1';
const DATE = '2026-09-25';

function entry(id: string) {
  return {
    id,
    user_id: USER_ID,
    date: DATE,
    meal_type: 'lunch',
    food_name: 'Garbanzos',
    barcode: null,
    brand: null,
    serving_size_g: 100,
    calories: 200,
    protein_g: 15,
    carbs_g: 25,
    fat_g: 4,
    fiber_g: 6,
    sugar_g: 1,
    saturated_fat_g: 0.5,
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
  } as import('@/utils/foodEntry').NewFoodLogEntry;
}

describe('diaryStore.addEntry — un fallo real de analytics no afecta al guardado', () => {
  it('el insert de analytics_events falla (sin conexión) → addEntry sigue devolviendo éxito', async () => {
    mockAnalyticsInsert.mockResolvedValue({ error: { message: 'TypeError: Network request failed' } });
    const { useDiaryStore } = freshModules();

    const result = await useDiaryStore.getState().addEntry(entry('entry-A'));
    await flush();

    expect(result.error).toBeNull(); // la comida se guardó bien, pese al fallo de analytics
    expect(mockAnalyticsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'first_food_logged' })
    );
  });

  it('sin sesión (analytics no puede ni intentar el insert) → addEntry sigue devolviendo éxito', async () => {
    const { useDiaryStore } = freshModules();
    mockGetSession.mockResolvedValue({ data: { session: null } }); // freshModules() ya lo pone en sesión válida; se sobreescribe aquí

    const result = await useDiaryStore.getState().addEntry(entry('entry-B'));
    await flush();

    expect(result.error).toBeNull();
    expect(mockAnalyticsInsert).not.toHaveBeenCalled();
  });

  it('addEntry() no se queda esperando a la red de analytics: resuelve mientras el insert sigue en vuelo', async () => {
    let resolveInsert: (v: { error: null }) => void = () => {};
    mockAnalyticsInsert.mockImplementation(
      () => new Promise((resolve) => { resolveInsert = resolve; })
    );
    const { useDiaryStore } = freshModules();

    // Si `addEntry` esperase a que el insert de analytics termine, este
    // `await` no resolvería nunca y el test haría timeout.
    const result = await useDiaryStore.getState().addEntry(entry('entry-C'));

    expect(result.error).toBeNull();
    expect(mockAnalyticsInsert).toHaveBeenCalledTimes(1); // ya lanzado...
    resolveInsert({ error: null }); // ...pero todavía pendiente cuando addEntry ya había resuelto.
    await flush();
  });
});
