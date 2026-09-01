/**
 * Estado Pro y límites del plan free.
 * - En Android: comprueba el entitlement de RevenueCat (Google Play Billing).
 * - Fallback: perfil de Supabase para suscriptores de la web (Stripe).
 *
 * La regla de decisión vive en `@/utils/proEntitlement` como función pura para
 * poder cubrirla con tests: es la que decide quién tiene acceso de pago.
 */
import { useAuthStore } from '@/stores/authStore';
import { usePurchasesStore } from '@/stores/purchasesStore';
import { hasProEntitlement } from '@/utils/proEntitlement';

export const FREE_HISTORY_DAYS = 14;
export const FREE_RECIPE_LIMIT = 3;
export const FREE_SUPPLEMENT_LIMIT = 3;

export function usePro(): { isPro: boolean } {
  const profile = useAuthStore((s) => s.profile);
  const customerInfo = usePurchasesStore((s) => s.customerInfo);

  return { isPro: hasProEntitlement({ profile, customerInfo }) };
}
