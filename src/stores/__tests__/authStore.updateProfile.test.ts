/**
 * Regresión del P0 de `subscription_tier`, a nivel de store.
 *
 * Comprueba la carga útil REAL que `updateProfile()` manda a Supabase: aunque
 * alguien llame al store saltándose los tipos (un `as any`, JS sin tipar), la
 * petición nunca debe contener columnas de suscripción.
 */
import type { Profile } from '@/types';

// ── Captura de la carga útil enviada a supabase ──────────────────────────────
const mockSentPayloads: Record<string, unknown>[] = [];
let mockUpdateResponse: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        mockSentPayloads.push(payload);
        return {
          eq: () => ({
            select: () => ({
              single: async () => mockUpdateResponse,
            }),
          }),
        };
      },
    }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));

jest.mock('@/db/database', () => ({
  kvGet: jest.fn(async () => null),
  kvSet: jest.fn(async () => undefined),
}));

jest.mock('@/stores/purchasesStore', () => ({
  usePurchasesStore: { getState: () => ({ init: jest.fn(), reset: jest.fn() }) },
}));

jest.mock('expo-linking', () => ({ createURL: (p: string) => `vegantrack://${p}` }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

import { useAuthStore } from '@/stores/authStore';

const BASE_PROFILE = {
  id: 'user-1',
  display_name: 'Ana',
  subscription_tier: 'free',
  subscription_expires_at: null,
  stripe_customer_id: null,
  weight_kg: 62,
} as unknown as Profile;

// El saneador avisa por consola en DEV cuando descarta columnas: es el
// comportamiento esperado en varios de estos tests, así que lo silenciamos
// para no ensuciar la salida (y de paso comprobamos que efectivamente avisa).
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockSentPayloads.length = 0;
  mockUpdateResponse = { data: { ...BASE_PROFILE }, error: null };
  useAuthStore.setState({
    user: { id: 'user-1' } as never,
    profile: { ...BASE_PROFILE },
  });
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('authStore.updateProfile', () => {
  it('envía las columnas legítimas del perfil', async () => {
    await useAuthStore.getState().updateProfile({ display_name: 'Ana B', weight_kg: 64 });

    expect(mockSentPayloads).toHaveLength(1);
    expect(mockSentPayloads[0]).toMatchObject({ display_name: 'Ana B', weight_kg: 64 });
    expect(mockSentPayloads[0]).toHaveProperty('updated_at');
  });

  it('NUNCA envía subscription_tier, aunque el llamante lo fuerce', async () => {
    await useAuthStore.getState().updateProfile({
      display_name: 'Ana',
      subscription_tier: 'pro',
      subscription_expires_at: '2099-01-01T00:00:00.000Z',
      stripe_customer_id: 'cus_hackeado',
    } as never);

    expect(mockSentPayloads).toHaveLength(1);
    expect(mockSentPayloads[0]).not.toHaveProperty('subscription_tier');
    expect(mockSentPayloads[0]).not.toHaveProperty('subscription_expires_at');
    expect(mockSentPayloads[0]).not.toHaveProperty('stripe_customer_id');
    expect(mockSentPayloads[0]).toMatchObject({ display_name: 'Ana' });
    // Y deja constancia en desarrollo de que ha descartado algo.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('subscription_tier'));
  });

  it('no concede Pro ni siquiera de forma optimista en la UI', async () => {
    // El fallo original: `set({ profile: {...current, ...patch} })` pintaba Pro
    // en la interfaz antes de que el servidor dijera nada.
    mockUpdateResponse = { data: { ...BASE_PROFILE }, error: null };

    await useAuthStore.getState().updateProfile({ subscription_tier: 'pro' } as never);

    expect(useAuthStore.getState().profile?.subscription_tier).toBe('free');
  });

  it('no hace ninguna petición si el patch sólo trae columnas protegidas', async () => {
    const res = await useAuthStore.getState().updateProfile({
      subscription_tier: 'pro',
    } as never);

    expect(mockSentPayloads).toHaveLength(0);
    expect(res.error).toBeNull();
  });

  it('revierte el perfil optimista si el servidor rechaza la actualización', async () => {
    mockUpdateResponse = { data: null, error: { message: 'permission denied for column subscription_tier' } };

    const res = await useAuthStore.getState().updateProfile({ display_name: 'Ana C' });

    expect(res.error).toBe('permission denied for column subscription_tier');
    expect(useAuthStore.getState().profile?.display_name).toBe('Ana');
  });
});
