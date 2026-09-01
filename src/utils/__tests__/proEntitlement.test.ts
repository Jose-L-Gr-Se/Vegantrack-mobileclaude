/**
 * Semántica del entitlement Pro.
 *
 * Existen por lo que destapó el escenario 5 de
 * supabase/verify-subscription-guard.sql: una degradación a free del webhook
 * que se aplica a medias.
 *
 * El handler de EXPIRATION escribe DOS columnas a la vez:
 *     subscription_tier = 'free'  Y  subscription_expires_at = null
 *
 * Y una caducidad nula significa "no caduca nunca". Es decir: si la escritura
 * de `subscription_expires_at` cuajara y la de `subscription_tier` no, el
 * usuario pasaría de "Pro hasta el día X" a **Pro para siempre**. El fallo no
 * sería neutro: sería una mejora silenciosa del entitlement.
 *
 * De ahí que la degradación deba verificarse como una transición observada, y
 * no dando por hecho que el UPDATE se aplicó.
 */
import {
  hasProEntitlement,
  hasProfilePro,
  hasRevenueCatPro,
} from '@/utils/proEntitlement';
import type { ProProfileFields } from '@/utils/proEntitlement';

const AHORA = Date.parse('2026-09-01T12:00:00.000Z');
const PASADO = '2026-08-01T12:00:00.000Z';
const FUTURO = '2026-10-01T12:00:00.000Z';

const perfil = (
  tier: 'free' | 'pro',
  expires: string | null
): ProProfileFields => ({
  subscription_tier: tier,
  subscription_expires_at: expires,
});

const SIN_COMPRA = null;
const CON_COMPRA = { entitlements: { active: { pro: { productIdentifier: 'annual' } } } };

describe('hasProfilePro', () => {
  it('free sin caducidad no es Pro', () => {
    expect(hasProfilePro(perfil('free', null), AHORA)).toBe(false);
  });

  it('pro con caducidad futura es Pro', () => {
    expect(hasProfilePro(perfil('pro', FUTURO), AHORA)).toBe(true);
  });

  it('pro con caducidad pasada NO es Pro', () => {
    expect(hasProfilePro(perfil('pro', PASADO), AHORA)).toBe(false);
  });

  it('el tier manda: free con caducidad futura no concede nada', () => {
    expect(hasProfilePro(perfil('free', FUTURO), AHORA)).toBe(false);
  });

  it('sin perfil no es Pro', () => {
    expect(hasProfilePro(null, AHORA)).toBe(false);
    expect(hasProfilePro(undefined, AHORA)).toBe(false);
  });

  it('la caducidad se compara en el instante exacto, no antes', () => {
    const justo = '2026-09-01T12:00:00.000Z';
    expect(hasProfilePro(perfil('pro', justo), AHORA)).toBe(false);
    expect(hasProfilePro(perfil('pro', justo), AHORA - 1)).toBe(true);
  });
});

describe('el estado peligroso que destapó el escenario 5', () => {
  it('tier=pro con caducidad NULL concede Pro indefinidamente', () => {
    // Comportamiento actual y deliberado (cubre a los suscriptores web sin
    // fecha). Queda fijado aquí porque es lo que convierte una degradación a
    // medias en un entitlement perpetuo.
    expect(hasProfilePro(perfil('pro', null), AHORA)).toBe(true);
  });

  it('una degradación EXPIRATION aplicada a medias deja Pro para siempre', () => {
    // Partida: Pro hasta una fecha concreta.
    expect(hasProfilePro(perfil('pro', FUTURO), AHORA)).toBe(true);

    // El webhook escribe las dos columnas. Si sólo cuaja la fecha:
    expect(hasProfilePro(perfil('pro', null), AHORA)).toBe(true);          // nunca caduca
    // ...y sigue siendo Pro incluso mucho después de la fecha original.
    expect(hasProfilePro(perfil('pro', null), AHORA + 1e12)).toBe(true);

    // La degradación completa sí retira el acceso.
    expect(hasProfilePro(perfil('free', null), AHORA)).toBe(false);
  });
});

describe('hasRevenueCatPro', () => {
  it('concede Pro con un entitlement activo', () => {
    expect(hasRevenueCatPro(CON_COMPRA)).toBe(true);
  });

  it('no concede nada sin customerInfo ni con entitlements vacíos', () => {
    expect(hasRevenueCatPro(SIN_COMPRA)).toBe(false);
    expect(hasRevenueCatPro(undefined)).toBe(false);
    expect(hasRevenueCatPro({ entitlements: { active: {} } })).toBe(false);
  });
});

describe('hasProEntitlement', () => {
  it('RevenueCat concede Pro aunque el perfil siga en free', () => {
    // Es lo que permite que ProModal ya no escriba subscription_tier: tras
    // comprar, customerInfo da Pro al instante y el webhook actualiza el perfil.
    expect(
      hasProEntitlement({ profile: perfil('free', null), customerInfo: CON_COMPRA, now: AHORA })
    ).toBe(true);
  });

  it('el perfil concede Pro aunque no haya compra en RevenueCat (suscriptor web)', () => {
    expect(
      hasProEntitlement({ profile: perfil('pro', FUTURO), customerInfo: SIN_COMPRA, now: AHORA })
    ).toBe(true);
  });

  it('sin ninguna de las dos fuentes, no es Pro', () => {
    expect(
      hasProEntitlement({ profile: perfil('free', null), customerInfo: SIN_COMPRA, now: AHORA })
    ).toBe(false);
    expect(
      hasProEntitlement({ profile: null, customerInfo: null, now: AHORA })
    ).toBe(false);
  });
});
