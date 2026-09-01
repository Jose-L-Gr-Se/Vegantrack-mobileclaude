/**
 * Regresión del P0 de `subscription_tier`.
 *
 * Estos tests cubren la capa cliente. Las capas que de verdad protegen el dato
 * están en Postgres y se verifican con supabase/verify-subscription-guard.sql.
 */
import {
  CLIENT_READONLY_PROFILE_COLUMNS,
  ENTITLEMENT_PROFILE_COLUMNS,
  sanitizeProfilePatch,
} from '@/utils/profilePatch';

describe('ENTITLEMENT_PROFILE_COLUMNS', () => {
  it('cubre exactamente las tres columnas que sólo puede escribir service_role', () => {
    // Si esta lista cambia, hay que cambiar también la allowlist invertida de
    // supabase/migrations/20260901000000_protect_subscription_columns.sql
    expect([...ENTITLEMENT_PROFILE_COLUMNS].sort()).toEqual([
      'stripe_customer_id',
      'subscription_expires_at',
      'subscription_tier',
    ]);
  });

  it('todas las columnas de entitlement son de sólo lectura para el cliente', () => {
    for (const col of ENTITLEMENT_PROFILE_COLUMNS) {
      expect(CLIENT_READONLY_PROFILE_COLUMNS).toContain(col);
    }
  });
});

describe('sanitizeProfilePatch', () => {
  it('descarta subscription_tier aunque llegue con el resto del perfil', () => {
    const { patch, removed } = sanitizeProfilePatch({
      display_name: 'Ana',
      weight_kg: 62,
      subscription_tier: 'pro',
    });

    expect(patch).toEqual({ display_name: 'Ana', weight_kg: 62 });
    expect(removed).toEqual(['subscription_tier']);
    expect(patch).not.toHaveProperty('subscription_tier');
  });

  it('descarta todas las columnas de suscripción a la vez', () => {
    const { patch, removed } = sanitizeProfilePatch({
      subscription_tier: 'pro',
      subscription_expires_at: '2099-01-01T00:00:00.000Z',
      stripe_customer_id: 'cus_hackeado',
      goal: 'bulk',
    });

    expect(patch).toEqual({ goal: 'bulk' });
    expect(removed.sort()).toEqual([
      'stripe_customer_id',
      'subscription_expires_at',
      'subscription_tier',
    ]);
  });

  it('descarta la identidad de la fila (id, created_at)', () => {
    const { patch, removed } = sanitizeProfilePatch({
      id: 'otro-usuario',
      created_at: '2020-01-01T00:00:00.000Z',
      display_name: 'Ana',
    });

    expect(patch).toEqual({ display_name: 'Ana' });
    expect(removed.sort()).toEqual(['created_at', 'id']);
  });

  it('deja intacto un patch legítimo de onboarding', () => {
    const onboarding = {
      display_name: 'Ana',
      height_cm: 168,
      weight_kg: 62,
      birth_date: '1992-05-11',
      sex: 'female',
      activity_level: 'moderate',
      goal: 'maintain',
      calorie_target: 2100,
      protein_target_g: 112,
      carbs_target_g: 262,
      fat_target_g: 58,
    };

    const { patch, removed } = sanitizeProfilePatch(onboarding);

    expect(patch).toEqual(onboarding);
    expect(removed).toEqual([]);
  });

  it('deja intacta la actualización de peso que hace weightStore', () => {
    const { patch, removed } = sanitizeProfilePatch({ weight_kg: 70.5 });
    expect(patch).toEqual({ weight_kg: 70.5 });
    expect(removed).toEqual([]);
  });

  it('no muta el objeto original', () => {
    const original = { display_name: 'Ana', subscription_tier: 'pro' };
    sanitizeProfilePatch(original);
    expect(original).toEqual({ display_name: 'Ana', subscription_tier: 'pro' });
  });

  it('devuelve un patch vacío si sólo llegan columnas protegidas', () => {
    const { patch, removed } = sanitizeProfilePatch({ subscription_tier: 'pro' });
    expect(patch).toEqual({});
    expect(removed).toEqual(['subscription_tier']);
  });
});
