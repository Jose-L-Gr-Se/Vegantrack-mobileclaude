/**
 * Señal de producto "ha registrado alguna vez" (`has_logged_food:<userId>`)
 * integrada en `diaryStore`, con SQLite real (adaptador de test) y sin
 * mockear `@/lib/analytics`: demuestra que la señal es independiente de la
 * marca de analítica `first_food_logged_tracked`.
 */
jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null, fetchProfile: jest.fn() }) } }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/notifications/reminders', () => ({
  getReminderHour: jest.fn().mockResolvedValue(null),
  getReminderOfferShown: jest.fn().mockResolvedValue(true),
  markReminderOfferShown: jest.fn().mockResolvedValue(undefined),
  onMealLogged: jest.fn().mockResolvedValue(undefined),
}));

const mockGetSession = jest.fn();
const mockAnalyticsInsert = jest.fn();
const mockFoodLogUpsert = jest.fn();
const mockFoodLogDelete = jest.fn();
const mockFoodLogSelect = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    from: (table: string) => {
      if (table === 'analytics_events') return { insert: (...args: unknown[]) => mockAnalyticsInsert(...args) };
      if (table === 'food_log') {
        return {
          upsert: (...args: unknown[]) => mockFoodLogUpsert(...args),
          delete: () => ({ eq: (...args: unknown[]) => mockFoodLogDelete(...args) }),
          select: () => ({ eq: () => ({ eq: () => ({ order: () => mockFoodLogSelect() }) }) }),
        };
      }
      throw new Error(`tabla inesperada en el mock: ${table}`);
    },
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

const USER_ID = 'user-1';
const DATE = '2026-09-25';

type Modules = {
  useDiaryStore: typeof import('@/stores/diaryStore').useDiaryStore;
  hasLoggedFood: typeof import('@/lib/foodLoggingHistory').hasLoggedFood;
  kvGet: typeof import('@/db/database').kvGet;
};

function freshModules(): Modules {
  jest.resetModules();
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
  mockAnalyticsInsert.mockReset().mockResolvedValue({ error: null });
  mockFoodLogUpsert.mockReset().mockResolvedValue({ error: null });
  mockFoodLogDelete.mockReset().mockResolvedValue({ error: null });
  mockFoodLogSelect.mockReset().mockResolvedValue({ data: [], error: null });
  return {
    useDiaryStore: require('@/stores/diaryStore').useDiaryStore,
    hasLoggedFood: require('@/lib/foodLoggingHistory').hasLoggedFood,
    kvGet: require('@/db/database').kvGet,
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

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

describe('diaryStore — señal de producto has_logged_food', () => {
  it('sin ningún registro, la señal no existe', async () => {
    const { hasLoggedFood } = freshModules();
    await expect(hasLoggedFood(USER_ID)).resolves.toBe(false);
  });

  it('la primera comida la marca aunque falle la analítica: first_food_logged_tracked queda sin marcar', async () => {
    const { useDiaryStore, hasLoggedFood, kvGet } = freshModules();
    mockAnalyticsInsert.mockResolvedValue({ error: { message: 'Network request failed' } });

    const res = await useDiaryStore.getState().addEntry(entry('e1'));
    await flush();

    expect(res.error).toBeNull();
    await expect(hasLoggedFood(USER_ID)).resolves.toBe(true);
    // Las dos señales son independientes: la de analítica NO se confirmó.
    expect(await kvGet<boolean>(`first_food_logged_tracked:${USER_ID}`)).toBeNull();
  });

  it('también sin red para la comida (upsert remoto falla): basta con el guardado local', async () => {
    const { useDiaryStore, hasLoggedFood } = freshModules();
    // Forma real de supabase-js sin red: resuelve con un error sin `code`
    // (transitorio), no rechaza. La entrada queda pendiente en local.
    mockAnalyticsInsert.mockResolvedValue({ error: { message: 'TypeError: Network request failed' } });
    mockFoodLogUpsert.mockResolvedValue({ error: { message: 'TypeError: Network request failed' } });

    const res = await useDiaryStore.getState().addEntry(entry('e1'));
    await flush();

    expect(res.error).toBeNull();
    await expect(hasLoggedFood(USER_ID)).resolves.toBe(true);
  });

  it('con la analítica funcionando, ambas señales quedan marcadas — cada una por su cuenta', async () => {
    const { useDiaryStore, hasLoggedFood, kvGet } = freshModules();
    await useDiaryStore.getState().addEntry(entry('e1'));
    await flush();

    await expect(hasLoggedFood(USER_ID)).resolves.toBe(true);
    expect(await kvGet<boolean>(`first_food_logged_tracked:${USER_ID}`)).toBe(true);
  });

  it('borrar todas las comidas no elimina la señal', async () => {
    const { useDiaryStore, hasLoggedFood } = freshModules();
    useDiaryStore.setState({ selectedDate: DATE });
    await useDiaryStore.getState().addEntry(entry('e1'));
    await useDiaryStore.getState().addEntry(entry('e2'));

    await useDiaryStore.getState().deleteEntry('e1');
    await useDiaryStore.getState().deleteEntry('e2');
    await flush();

    expect(useDiaryStore.getState().entries).toEqual([]);
    await expect(hasLoggedFood(USER_ID)).resolves.toBe(true);
  });

  it('un usuario que ya registraba antes de existir la señal queda marcado al cargar un día con entradas', async () => {
    const { useDiaryStore, hasLoggedFood } = freshModules();
    mockFoodLogSelect.mockResolvedValue({
      data: [{ ...entry('remote-1'), created_at: `${DATE}T10:00:00Z`, updated_at: `${DATE}T10:00:00Z` }],
      error: null,
    });
    useDiaryStore.setState({ selectedDate: DATE });

    await useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flush();

    await expect(hasLoggedFood(USER_ID)).resolves.toBe(true);
  });

  it('cargar un día vacío no marca nada', async () => {
    const { useDiaryStore, hasLoggedFood } = freshModules();
    useDiaryStore.setState({ selectedDate: DATE });

    await useDiaryStore.getState().fetchEntries(USER_ID, DATE);
    await flush();

    await expect(hasLoggedFood(USER_ID)).resolves.toBe(false);
  });
});
