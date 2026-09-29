/**
 * Auditoría de peso y evolución corporal — `addLog()` ya mantenía
 * `profiles.weight_kg` sincronizado con el ÚLTIMO peso registrado ("igual
 * que la PWA"), pero `deleteLog()` no lo tocaba en absoluto. Borrar el
 * registro más reciente (p. ej. un error de tecleo) dejaba el perfil con un
 * peso que ya no tiene ningún registro que lo respalde — una cifra huérfana
 * que `EditProfileModal` precarga como valor por defecto y que
 * `calculateTargets()` usa para el BMR/TDEE si el usuario guarda cualquier
 * otro cambio de perfil sin tocar el peso a mano.
 *
 * Mismo arnés que `weightStore.flushPending.test.ts` (SQLite real + builder
 * de Supabase controlable), con `useAuthStore.updateProfile` capturado para
 * comprobar con qué se resincroniza el perfil tras un borrado.
 */
import type * as DatabaseModule from '@/db/database';
import type * as WeightStoreModule from '@/stores/weightStore';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) }) },
}));

const USER_ID = 'user-1';

function mockWeightLogsTable() {
  mockFrom.mockImplementation(() => ({
    upsert: () => Promise.resolve({ error: null }),
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }));
}

function freshModules() {
  jest.resetModules();
  mockFrom.mockReset();
  mockUpdateProfile.mockClear();
  const db = require('@/db/database') as typeof DatabaseModule;
  const weightStore = require('@/stores/weightStore') as typeof WeightStoreModule;
  return { db, weightStore };
}

describe('weightStore.deleteLog — resincroniza profiles.weight_kg tras borrar', () => {
  it('borrar el registro MÁS RECIENTE resincroniza el perfil con el que queda (el anterior), no lo deja huérfano', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable();
    const store = weightStore.useWeightStore;

    await store.getState().addLog(USER_ID, '2026-09-01', 70);
    mockUpdateProfile.mockClear();
    await store.getState().addLog(USER_ID, '2026-09-05', 71); // el más reciente, con un error de tecleo
    expect(mockUpdateProfile).toHaveBeenLastCalledWith({ weight_kg: 71 });
    mockUpdateProfile.mockClear();

    const latestLogId = store.getState().logs.find((l) => l.date === '2026-09-05')!.id;
    await store.getState().deleteLog(latestLogId);

    // Sin el fix: `updateProfile` no se llamaría en absoluto tras borrar, y
    // el perfil se quedaría con weight_kg: 71 aunque ya no exista ese registro.
    expect(mockUpdateProfile).toHaveBeenCalledWith({ weight_kg: 70 });
    expect(store.getState().logs.map((l) => l.date)).toEqual(['2026-09-01']);
  });

  it('borrar un registro que NO es el más reciente también resincroniza (sin cambio real, pero nunca deja el perfil desalineado)', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable();
    const store = weightStore.useWeightStore;

    await store.getState().addLog(USER_ID, '2026-09-01', 70);
    const oldLogId = store.getState().logs.find((l) => l.date === '2026-09-01')!.id;
    await store.getState().addLog(USER_ID, '2026-09-05', 68);
    mockUpdateProfile.mockClear();

    await store.getState().deleteLog(oldLogId);

    expect(mockUpdateProfile).toHaveBeenCalledWith({ weight_kg: 68 }); // sigue siendo el más reciente
    expect(store.getState().logs.map((l) => l.date)).toEqual(['2026-09-05']);
  });

  it('borrar el ÚNICO registro no llama a updateProfile — no hay ningún peso registrado con el que resincronizar', async () => {
    const { weightStore } = freshModules();
    mockWeightLogsTable();
    const store = weightStore.useWeightStore;

    await store.getState().addLog(USER_ID, '2026-09-05', 70);
    const onlyLogId = store.getState().logs[0].id;
    mockUpdateProfile.mockClear();

    await store.getState().deleteLog(onlyLogId);

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(store.getState().logs).toEqual([]);
  });
});
