/**
 * Auditoría del histórico y navegación por días — `fetchEntries()` lee
 * primero el espejo local (paso 1, "render inmediato") y luego el remoto
 * (paso 2, sección crítica frente a `flushPending`). El paso 2 YA comprueba
 * `get().selectedDate === date` antes de aplicar su resultado (para no pisar
 * una fecha más nueva con una respuesta tardía) — pero el paso 1 no lo
 * comprobaba en absoluto.
 *
 * Con navegación rápida de fecha (dos taps seguidos en ‹/›, o adelante y
 * atrás), dos `fetchEntries` de fechas distintas quedan en vuelo a la vez.
 * Si el paso 1 de la llamada MÁS VIEJA (fecha ya abandonada) resuelve
 * DESPUÉS que el de la llamada más nueva, pisaba `entries` con las de la
 * fecha vieja — y si el paso 2 no llega a corregirlo (sin red, o su propio
 * SELECT también tarda) esa fecha equivocada se queda mostrada sin que nada
 * la corrija. Este test aísla exactamente el paso 1 (el remoto falla al
 * instante, así que el paso 2 nunca toca `entries`) para demostrar el bug y
 * su fix con temporización controlada, no con timings frágiles.
 */
import type * as DatabaseModule from '@/db/database';
import type * as DiaryStoreModule from '@/stores/diaryStore';
import type { FoodLogEntry } from '@/types';

jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ profile: null, fetchProfile: jest.fn() }) } }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

// El remoto falla al instante (offline) en todas las llamadas: `merged` es
// siempre `false`, así que el paso 2 de `fetchEntries` nunca llega a tocar
// `entries` — aísla el bug/fix al paso 1 (local), sin que el paso 2 (ya
// guardado) pueda enmascararlo ni corregirlo.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'offline' } }),
          }),
        }),
      }),
    }),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

// `mirrorList` no se resuelve solo: queda "en vuelo" hasta que el test llama
// a `resolveLocalRead(date, rows)` — permite demostrar, con control exacto
// del orden de resolución, que una respuesta tardía de una fecha YA
// ABANDONADA no debe poder pisar la fecha actualmente seleccionada.
function mockLocalMirror() {
  const pending: Array<{ date: string; resolve: (rows: { payload: FoodLogEntry }[]) => void }> = [];
  jest.doMock('@/db/database', () => ({
    mirrorList: jest.fn(
      (_table: string, _userId: string, date: string) =>
        new Promise((resolve) => {
          pending.push({ date, resolve });
        })
    ),
    mirrorReplaceDay: jest.fn(),
    mirrorMarkSynced: jest.fn(),
    mirrorPending: jest.fn().mockResolvedValue([]),
    mirrorRemove: jest.fn(),
    mirrorMarkDeleted: jest.fn(),
    mirrorUpsert: jest.fn(),
  }));
  return {
    // Resuelve la llamada más antigua todavía pendiente para esa fecha —
    // simula que su respuesta "llega" en ese momento, en el orden que decida
    // el test, no en el orden en que se llamó a fetchEntries().
    resolveLocalRead(date: string, rows: { payload: FoodLogEntry }[]) {
      const idx = pending.findIndex((p) => p.date === date);
      if (idx === -1) throw new Error(`No hay una lectura local pendiente para ${date}`);
      const [entry] = pending.splice(idx, 1);
      entry.resolve(rows);
    },
  };
}

function entry(id: string, date: string): FoodLogEntry {
  return {
    id, user_id: 'user-1', date, meal_type: 'lunch', food_name: `Comida ${date}`,
    barcode: null, brand: null, serving_size_g: 100, calories: 100, protein_g: 10,
    carbs_g: 20, fat_g: 5, fiber_g: 3, sugar_g: 1, saturated_fat_g: 1, sodium_mg: 100,
    vitamin_b12_mcg: null, iron_mg: null, zinc_mg: null, calcium_mg: null, omega3_g: null,
    vitamin_d_mcg: null, vitamin_b12_known: false, iron_known: false, zinc_known: false,
    calcium_known: false, omega3_known: false, vitamin_d_known: false,
    source: 'manual', source_ref: null, is_vegan: true, image_url: null, created_at: '',
  } as FoodLogEntry;
}

function freshModules() {
  jest.resetModules();
  const { resolveLocalRead } = mockLocalMirror();
  const db = require('@/db/database') as typeof DatabaseModule;
  const diaryStore = require('@/stores/diaryStore') as typeof DiaryStoreModule;
  return { db, diaryStore, resolveLocalRead };
}

describe('diaryStore.fetchEntries — navegación rápida de fecha no debe mostrar la fecha equivocada', () => {
  it('una lectura local tardía de una fecha YA ABANDONADA no pisa las entradas de la fecha actual', async () => {
    const { diaryStore, resolveLocalRead } = freshModules();
    const store = diaryStore.useDiaryStore;

    // Doble navegación rápida: D1 -> D2, como pulsar "siguiente" dos veces
    // seguidas antes de que la primera pantalla termine de cargar.
    store.getState().setDate('2026-09-10');
    const fetchD1 = store.getState().fetchEntries('user-1', '2026-09-10');
    store.getState().setDate('2026-09-11');
    const fetchD2 = store.getState().fetchEntries('user-1', '2026-09-11');

    // La respuesta de la fecha NUEVA llega primero (caso normal: el usuario
    // ya está mirando D2 cuando esta resuelve).
    resolveLocalRead('2026-09-11', [{ payload: entry('e2', '2026-09-11') }]);
    // La respuesta de la fecha VIEJA (D1) llega tarde, después de que el
    // usuario ya haya avanzado a D2 — nunca debería aplicarse.
    resolveLocalRead('2026-09-10', [{ payload: entry('e1', '2026-09-10') }]);

    await Promise.all([fetchD1, fetchD2]);

    // Sin el guard, esta última resolución (de D1) pisaría `entries` con la
    // comida del día ya abandonado, aunque `selectedDate` sea D2.
    expect(store.getState().selectedDate).toBe('2026-09-11');
    expect(store.getState().entries.map((e) => e.id)).toEqual(['e2']);
  });

  it('caso normal (sin carrera): la lectura local de la única fecha en vuelo sí se aplica', async () => {
    const { diaryStore, resolveLocalRead } = freshModules();
    const store = diaryStore.useDiaryStore;

    store.getState().setDate('2026-09-12');
    const fetchPromise = store.getState().fetchEntries('user-1', '2026-09-12');
    resolveLocalRead('2026-09-12', [{ payload: entry('e3', '2026-09-12') }]);
    await fetchPromise;

    expect(store.getState().entries.map((e) => e.id)).toEqual(['e3']);
  });
});
