/**
 * Auditoría de activación — oferta única del recordatorio diario tras la
 * primera comida de un usuario.
 *
 * `diaryStore.addEntry` es el único punto común a CUALQUIER método de
 * registrar comida (búsqueda, foto-IA, recetas, copiar entradas — todos
 * llaman a este mismo `addEntry`, ver `ProductDetailSheet.commit()`,
 * `AddFoodModal.confirm()` y `recipeStore.logRecipe`): nunca distingue por
 * `entry.source`, así que estos tests con `source: 'ai_photo'` y
 * `source: 'openfoodfacts'` prueban a la vez "IA y búsqueda comparten el
 * mismo comportamiento" — no hay ninguna rama de código que pueda
 * diferenciarlas.
 *
 * `useUiStore` es la señal real (no mockeada): `reminderOfferPending` es lo
 * que consume `FirstEntryReminderOffer` (ver su propio test) para decidir si
 * se muestra. `trackFirstFoodLoggedOnce` y las funciones de
 * `notifications/reminders` sí se mockean, para controlar de forma
 * determinista "primera comida", "oferta ya mostrada" y "recordatorio ya
 * activo" sin depender de KV/SQLite reales — ese mecanismo de base ya está
 * cubierto en `analytics.funnel.test.ts` y `reminders.test.ts`.
 */
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type * as UiStoreModule from '@/stores/uiStore';
import type { NewFoodLogEntry } from '@/utils/foodEntry';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));
// diaryStore.ts lee el perfil de authStore.getState() para el texto del
// recordatorio contextual — authStore importa purchasesStore ->
// react-native-purchases, un paquete con ESM que Jest no transforma sin mock.
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null, fetchProfile: jest.fn() }) } }));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

const mockTrackFirstFoodLoggedOnce = jest.fn();
jest.mock('@/lib/analytics', () => ({
  trackFirstFoodLoggedOnce: (...args: unknown[]) => mockTrackFirstFoodLoggedOnce(...args),
}));

const mockGetReminderHour = jest.fn();
const mockGetReminderOfferShown = jest.fn();
const mockMarkReminderOfferShown = jest.fn();
const mockOnMealLogged = jest.fn();
jest.mock('@/notifications/reminders', () => ({
  getReminderHour: (...args: unknown[]) => mockGetReminderHour(...args),
  getReminderOfferShown: (...args: unknown[]) => mockGetReminderOfferShown(...args),
  markReminderOfferShown: (...args: unknown[]) => mockMarkReminderOfferShown(...args),
  onMealLogged: (...args: unknown[]) => mockOnMealLogged(...args),
}));

const USER_ID = 'user-1';
const DATE = '2026-09-24';

/**
 * `jest.resetModules()` obliga a re-crear también `useUiStore` (`create()`
 * de Zustand corre una vez por módulo cargado) — así que se re-requiere
 * aquí, DESPUÉS del reset, en vez de importarlo una sola vez arriba: de lo
 * contrario `diaryStore` (re-requerido fresco en cada test) mutaría una
 * instancia de `useUiStore` distinta de la que leerían las aserciones.
 */
function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockTrackFirstFoodLoggedOnce.mockReset();
  mockGetReminderHour.mockReset();
  mockGetReminderOfferShown.mockReset();
  mockMarkReminderOfferShown.mockReset();
  mockOnMealLogged.mockReset().mockResolvedValue(undefined);
  mockFrom.mockImplementation(() => ({ upsert: () => Promise.resolve({ error: null }) }));
  return {
    diaryStore: require('@/stores/diaryStore') as typeof DiaryStoreModule,
    uiStore: require('@/stores/uiStore') as typeof UiStoreModule,
  };
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

/** `maybeOfferReminderAfterFirstEntry` es fire-and-forget dentro de
 * `addEntry` — da tiempo a que su promesa interna corra. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('diaryStore.addEntry — oferta de recordatorio tras la primera comida', () => {
  it('primera comida (sin recordatorio activo, sin oferta previa) → aparece', async () => {
    const { diaryStore, uiStore } = freshModules();
    mockTrackFirstFoodLoggedOnce.mockResolvedValue(true);
    mockGetReminderOfferShown.mockResolvedValue(false);
    mockGetReminderHour.mockResolvedValue(null);

    const result = await diaryStore.useDiaryStore.getState().addEntry(entry('entry-A'));
    await flush();

    expect(result.isFirstEntry).toBe(true);
    expect(uiStore.useUiStore.getState().reminderOfferPending).toBe(true);
    expect(mockMarkReminderOfferShown).toHaveBeenCalledWith(USER_ID);
  });

  it('segunda comida (no es la primera) → no aparece', async () => {
    const { diaryStore, uiStore } = freshModules();
    mockTrackFirstFoodLoggedOnce.mockResolvedValue(false);

    const result = await diaryStore.useDiaryStore.getState().addEntry(entry('entry-B'));
    await flush();

    expect(result.isFirstEntry).toBe(false);
    expect(uiStore.useUiStore.getState().reminderOfferPending).toBe(false);
    // Ni siquiera se comprueba nada del recordatorio: se corta antes.
    expect(mockGetReminderOfferShown).not.toHaveBeenCalled();
    expect(mockGetReminderHour).not.toHaveBeenCalled();
  });

  it('usuario con el recordatorio ya activo → no aparece (y no se marca "mostrada")', async () => {
    const { diaryStore, uiStore } = freshModules();
    mockTrackFirstFoodLoggedOnce.mockResolvedValue(true);
    mockGetReminderOfferShown.mockResolvedValue(false);
    mockGetReminderHour.mockResolvedValue(20); // ya activo

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-C'));
    await flush();

    expect(uiStore.useUiStore.getState().reminderOfferPending).toBe(false);
    expect(mockMarkReminderOfferShown).not.toHaveBeenCalled();
  });

  it('oferta ya mostrada antes ("Ahora no" o "Activar" en un guardado previo) → no vuelve a aparecer', async () => {
    const { diaryStore, uiStore } = freshModules();
    // Aunque `trackFirstFoodLoggedOnce` diera `true` (no debería poder pasar
    // dos veces para el mismo usuario, pero esta bandera propia es la
    // segunda capa de protección explícita que pide la ronda): la oferta ya
    // mostrada corta antes de tocar `useUiStore`.
    mockTrackFirstFoodLoggedOnce.mockResolvedValue(true);
    mockGetReminderOfferShown.mockResolvedValue(true);

    await diaryStore.useDiaryStore.getState().addEntry(entry('entry-D'));
    await flush();

    expect(uiStore.useUiStore.getState().reminderOfferPending).toBe(false);
    expect(mockGetReminderHour).not.toHaveBeenCalled();
    expect(mockMarkReminderOfferShown).not.toHaveBeenCalled();
  });

  it('IA y búsqueda comparten el mismo comportamiento: mismo resultado para entry.source ai_photo y openfoodfacts', async () => {
    const { diaryStore: aiDiaryStore, uiStore: aiUiStore } = freshModules();
    mockTrackFirstFoodLoggedOnce.mockResolvedValue(true);
    mockGetReminderOfferShown.mockResolvedValue(false);
    mockGetReminderHour.mockResolvedValue(null);
    await aiDiaryStore.useDiaryStore.getState().addEntry(entry('entry-ai', { source: 'ai_photo' }));
    await flush();
    const pendingAfterAi = aiUiStore.useUiStore.getState().reminderOfferPending;

    const { diaryStore: searchDiaryStore, uiStore: searchUiStore } = freshModules();
    mockTrackFirstFoodLoggedOnce.mockResolvedValue(true);
    mockGetReminderOfferShown.mockResolvedValue(false);
    mockGetReminderHour.mockResolvedValue(null);
    await searchDiaryStore.useDiaryStore.getState().addEntry(entry('entry-search', { source: 'openfoodfacts' }));
    await flush();
    const pendingAfterSearch = searchUiStore.useUiStore.getState().reminderOfferPending;

    expect(pendingAfterAi).toBe(true);
    expect(pendingAfterSearch).toBe(true);
    expect(pendingAfterAi).toBe(pendingAfterSearch);
  });
});
