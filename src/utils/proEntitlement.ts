/**
 * Decisión de entitlement Pro, pura y testeable.
 *
 * Se extrae de `usePro()` sin cambiar su comportamiento: es la regla que decide
 * quién tiene acceso de pago, así que merece cobertura determinista
 * (CLAUDE.md §8) en vez de vivir dentro de un hook.
 *
 * Hay dos fuentes, y basta con una:
 *   1. RevenueCat / Google Play Billing — el entitlement activo del SDK.
 *      Es la señal inmediata tras una compra y funciona sin tocar la BD.
 *   2. `profiles.subscription_tier` — la escribe el webhook de RevenueCat con
 *      `service_role`, y cubre además a los suscriptores web (Stripe).
 *
 * Ojo con la caducidad nula: significa "no caduca". Ver el bloque de tests.
 */
import type { Profile } from '@/types';

export const ENTITLEMENT_PRO = 'pro';

export type ProProfileFields = Pick<Profile, 'subscription_tier' | 'subscription_expires_at'>;

export interface ProEntitlementInput {
  profile: ProProfileFields | null | undefined;
  /** `customerInfo` de RevenueCat; sólo se mira si hay un entitlement activo. */
  customerInfo: { entitlements: { active: Record<string, unknown> } } | null | undefined;
  /** Inyectable para los tests. Por defecto, ahora. */
  now?: number;
}

/** ¿Concede Pro el entitlement de RevenueCat? */
export function hasRevenueCatPro(
  customerInfo: ProEntitlementInput['customerInfo']
): boolean {
  return customerInfo?.entitlements.active[ENTITLEMENT_PRO] !== undefined;
}

/**
 * ¿Concede Pro el perfil de Supabase?
 *
 * Requiere `subscription_tier === 'pro'` Y que no haya caducado. Una
 * `subscription_expires_at` nula se interpreta como "sin caducidad", que es lo
 * que necesitan los suscriptores web dados de alta sin fecha.
 */
export function hasProfilePro(
  profile: ProEntitlementInput['profile'],
  now: number = Date.now()
): boolean {
  if (profile?.subscription_tier !== 'pro') return false;
  if (!profile.subscription_expires_at) return true;
  return new Date(profile.subscription_expires_at).getTime() > now;
}

/** Regla completa: basta con que una de las dos fuentes conceda Pro. */
export function hasProEntitlement({
  profile,
  customerInfo,
  now = Date.now(),
}: ProEntitlementInput): boolean {
  return hasRevenueCatPro(customerInfo) || hasProfilePro(profile, now);
}
