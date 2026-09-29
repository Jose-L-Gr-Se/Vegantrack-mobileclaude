/**
 * Auditoría del loop de retención (primeros 7 días) — `update_streak` deja
 * `streak_count`/`last_log_date` al día en `profiles`, pero nada volvía a
 * leer ese perfil en el cliente: `authStore.fetchProfile()` sólo se llama en
 * transiciones de auth (login, arranque de la app), nunca al guardar una
 * comida. El único refuerzo positivo real que ya existe en el producto (🔥
 * Racha: N días en el Diario, y la fila "Racha" del VeganScore en Resumen)
 * leía siempre el perfil cacheado ANTES de la comida recién guardada, así
 * que un usuario que registraba su primera comida del día nunca veía su
 * racha reflejada hasta cerrar y reabrir la app.
 *
 * Mismo patrón que `diaryStore.updateStreak.test.ts` (SQLite real vía
 * adaptador de test + Supabase simulado). A diferencia de ese archivo (y de
 * los demás que mockean `authStore` de forma mínima sólo para que
 * `diaryStore.ts` no reviente), aquí `fetchProfile` es un mock estable y
 * espiable — un `getState()` que devolviera un objeto nuevo con un
 * `jest.fn()` nuevo en cada llamada no permitiría comprobar si SE LLAMÓ.
 */
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { NewFoodLogEntry } from '@/utils/foodEntry';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFetchProfile = jest.fn();
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ profile: null, fetchProfile: (...args: unknown[]) => mockFetchProfile(...args) }) },
}));

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ trackFirstFoodLoggedOnce: jest.fn() }));

const USER_ID = 'user-1';
const DATE = '2026-09-25';

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFetchProfile.mockReset();
  mockFrom.mockImplementation(() => ({
    upsert: () => Promise.resolve({ error: null }),
  }));
  mockRpc.mockImplementation(() => Promise.resolve({ error: null }));
  return { diaryStore: require('@/stores/diaryStore') as typeof DiaryStoreModule };
}

function entry(id: string, over: Partial<NewFoodLogEntry> = {}): NewFoodLogEntry {
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

/** `update_streak` y el refresco de perfil corren en segundo plano
 * (fire-and-forget), encadenados tras confirmar el guardado remoto — da
 * tiempo a que esas promesas internas corran antes de comprobar los mocks. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('diaryStore.addEntry — refresca el perfil tras confirmar la racha (loop de retención)', () => {
  it('update_streak confirmado → refresca el perfil local, para que la racha se vea sin reiniciar la app', async () => {
    const { diaryStore } = freshModules();
    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-A'));
    await flush();

    expect(mockRpc).toHaveBeenCalledWith('update_streak', { p_user_id: USER_ID, p_date: DATE });
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('update_streak falla (RPC rechazada) → NO se refresca el perfil (no hay nada nuevo que reflejar)', async () => {
    const { diaryStore } = freshModules();
    mockRpc.mockImplementation(() => Promise.reject(new Error('PGRST202: function not found')));

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-B'));
    await flush();

    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('update_streak devuelve {error} sin rechazar la promesa → igual que el resto de esta cadena (ver update_streak.test.ts), sólo se ignora un rechazo real; se refresca igualmente', async () => {
    const { diaryStore } = freshModules();
    mockRpc.mockImplementation(() => Promise.resolve({ error: { message: 'PGRST202' } }));

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-C'));
    await flush();

    // El propio `update_streak` ya trataba "resuelve con {error}" igual que
    // "resuelve sin error" antes de este arreglo (ambas ramas de su `.then`
    // no hacían nada) — este refresco sigue el mismo criterio: sólo un
    // rechazo real de la promesa (fallo de red) evita el refresco.
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('sin guardado remoto (offline) → no se llama a update_streak ni se refresca el perfil', async () => {
    const { diaryStore } = freshModules();
    mockFrom.mockImplementation(() => ({
      upsert: () => Promise.resolve({ error: { message: 'TypeError: Network request failed' } }),
    }));

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-D'));
    await flush();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('el refresco de perfil no bloquea a quien llama: addEntry resuelve sin esperar a que termine', async () => {
    let resolveFetchProfile: () => void = () => {};
    mockFetchProfile.mockImplementation(() => new Promise<void>((resolve) => { resolveFetchProfile = resolve; }));
    const { diaryStore } = freshModules();

    const result = await diaryStore.useDiaryStore.getState().addEntry(entry('entry-E'));
    await flush();

    expect(result.error).toBeNull();
    expect(mockFetchProfile).toHaveBeenCalledTimes(1); // ya lanzado...
    resolveFetchProfile(); // ...pero todavía pendiente cuando addEntry ya había resuelto.
  });

  it('un fallo dentro del propio refresco de perfil no afecta al resultado de addEntry (best-effort)', async () => {
    mockFetchProfile.mockRejectedValue(new Error('network error refetching profile'));
    const { diaryStore } = freshModules();

    const result = await diaryStore.useDiaryStore.getState().addEntry(entry('entry-F'));
    await flush();

    expect(result).toEqual({ error: null, isFirstEntry: false });
  });
});
