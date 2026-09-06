/**
 * Decisión de navegación raíz, aislada en su propio módulo (sin depender de
 * ninguna pantalla ni de react-navigation) — auditoría del bloqueo de
 * auth/perfil: permite testear "navegación según `authPhase`" sin montar
 * `NavigationContainer` ni arrastrar las más de 10 pantallas reales de la
 * app sólo para importar esta función pura.
 */
import type { AuthPhase } from '@/stores/authStore';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/types';

export type RootRoute = 'loading' | 'recovery' | 'auth' | 'onboarding' | 'main';

export function resolveRootRoute({
  authPhase,
  user,
  profile,
}: {
  authPhase: AuthPhase;
  user: User | null;
  profile: Profile | null;
}): RootRoute {
  if (authPhase === 'loading') return 'loading';

  // `recoverable_error`: ni sesión ni caché a la que recurrir. Y el caso
  // límite de `authenticated_cached_profile` SIN `user` confirmado (la
  // sesión en sí no se pudo confirmar por red, sólo hay un perfil cacheado
  // del último usuario conocido vía `last_user_id`) — no hay una sesión
  // real con la que entrar a la app todavía, así que nunca se entra al
  // árbol normal autenticado ni se trata al usuario como confirmado para
  // ninguna operación remota.
  if (authPhase === 'recoverable_error' || (authPhase === 'authenticated_cached_profile' && !user)) {
    return 'recovery';
  }

  if (!user) return 'auth';
  if (profile && !profile.calorie_target) return 'onboarding';
  return 'main';
}
