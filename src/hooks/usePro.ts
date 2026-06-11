/**
 * Estado Pro y límites del plan free (mismos límites que la PWA):
 * historial 14 días, 3 recetas, 3 suplementos.
 */
import { useAuthStore } from '@/stores/authStore';

export const FREE_HISTORY_DAYS = 14;
export const FREE_RECIPE_LIMIT = 3;
export const FREE_SUPPLEMENT_LIMIT = 3;

export function usePro(): { isPro: boolean } {
  const profile = useAuthStore((s) => s.profile);
  if (!profile) return { isPro: false };
  if (profile.subscription_tier !== 'pro') return { isPro: false };
  if (profile.subscription_expires_at) {
    return { isPro: new Date(profile.subscription_expires_at).getTime() > Date.now() };
  }
  return { isPro: true };
}
