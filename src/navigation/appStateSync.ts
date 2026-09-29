/**
 * Fase 2 del P1 de sincronización (ver auditoría de la rama fdcd26f): además
 * del disparo ya existente en login/arranque en frío (`RootNavigator`,
 * efecto sobre `user`), reintenta lo pendiente cuando la app vuelve a primer
 * plano — cubre el caso dominante de "el usuario recupera cobertura
 * mientras la app estaba en background/inactive" sin necesitar `NetInfo`.
 *
 * Aislado en su propio módulo (en vez de vivir sólo dentro de
 * `RootNavigator`) para poder testear la transición de `AppState` sin
 * montar el árbol de navegación completo (Ionicons, las 8 pantallas, etc.).
 * No reimplementa nada de `flushPending`: sólo decide CUÁNDO llamarlo. El
 * mutex `flushInFlight` de la Fase 1 (`diaryStore.ts`/`weightStore.ts`) sigue
 * siendo la única protección ante dos pasadas efectivas simultáneas — este
 * listener no añade ni necesita una segunda.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useWeightStore } from '@/stores/weightStore';

/**
 * Suscribe el listener. Devuelve la función de desuscripción — pensada para
 * el cleanup de un `useEffect(() => attachAppStateFlushListener(), [])` en
 * `RootNavigator` (deps vacías a propósito: se suscribe una única vez por
 * montaje y lee el usuario actual en el momento del evento, no en el
 * closure de montaje, así no hace falta resuscribirse en cada cambio de
 * `user` — que además ocurre, incidentalmente, en cada refresco de token).
 */
export function attachAppStateFlushListener(): () => void {
  let previousState: AppStateStatus = AppState.currentState;

  const subscription = AppState.addEventListener('change', (nextState) => {
    // Sólo nos interesa la transición HACIA 'active' viniendo de
    // background/inactive — nunca 'active' → 'active' (el propio AppState
    // no emite ese caso, pero comprobarlo explícitamente documenta la
    // intención y protege ante cualquier cambio futuro de esa garantía) ni
    // cualquier transición que no termine en 'active'.
    const cameToForeground = previousState.match(/inactive|background/) !== null && nextState === 'active';
    previousState = nextState;
    if (!cameToForeground) return;

    const user = useAuthStore.getState().user;
    if (!user) return;

    // Fire-and-forget: nunca debe bloquear la UI ni el propio evento de
    // AppState. `flushPending` ya es segura ante invocaciones concurrentes
    // (Fase 1) y nunca pierde una operación pendiente por un error.
    void useDiaryStore.getState().flushPending(user.id);
    void useWeightStore.getState().flushPending(user.id);
  });

  return () => subscription.remove();
}
