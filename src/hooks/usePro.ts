/**
 * Estado Pro y límites del plan free.
 * - En Android: comprueba el entitlement de RevenueCat (Google Play Billing).
 * - Fallback: perfil de Supabase para suscriptores de la web (Stripe).
 */
import { useAuthStore } from '@/stores/authStore';
import { usePurchasesStore, ENTITLEMENT_PRO } from '@/stores/purchasesStore';

export const FREE_HISTORY_DAYS = 14;
export const FREE_RECIPE_LIMIT = 3;
export const FREE_SUPPLEMENT_LIMIT = 3;

export function usePro(): { isPro: boolean } {
  const profile = useAuthStore((s) => s.profile);
  const customerInfo = usePurchasesStore((s) => s.customerInfo);

  // RevenueCat / Google Play Billing
  const rcPro = customerInfo?.entitlements.active[ENTITLEMENT_PRO] !== undefined ?? false;

  // Supabase: suscriptores web (Stripe) que no compraron desde la app
  const supabasePro =
    profile?.subscription_tier === 'pro' &&
    (!profile.subscription_expires_at ||
      new Date(profile.subscription_expires_at).getTime() > Date.now());

  return { isPro: rcPro || supabasePro };
}
