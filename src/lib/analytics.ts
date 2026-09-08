/**
 * Analítica de producto, mínima y propia. Inserta eventos del embudo en
 * Supabase (`analytics_events`) para poder medir activación, retención y
 * conversión. Es "best-effort": si falla, no rompe el flujo del usuario.
 * Sustituible por PostHog más adelante sin tocar las llamadas a `track()`.
 *
 * Auditoría de instrumentación del funnel de monetización: confirmado en
 * producción (Supabase, sólo lectura) que la tabla existe y recibe eventos
 * reales desde jun-2026, pero el embudo de compra estaba completamente sin
 * medir (`checkout_opened` nunca se había llamado ni una vez) y `paywall_viewed`
 * sólo cubría un gate de seis reales. Ver `purchasesStore.ts`, `ProModal.tsx`
 * y las pantallas con gates Free/Pro para los puntos de instrumentación.
 */
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import { todayISO } from '@/utils/dates';

export type AnalyticsEvent =
  | 'app_open'
  | 'photo_scan_started'
  | 'photo_scan_success'
  | 'photo_scan_quota_blocked'
  | 'photo_scan_error'
  | 'photo_entry_saved'
  | 'paywall_viewed'
  | 'onboarding_completed'
  | 'first_food_logged'
  | 'checkout_opened'
  | 'trial_started'
  | 'purchase_completed'
  | 'purchase_cancelled'
  | 'purchase_failed'
  | 'purchase_restored'
  | 'subscription_expired';

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  // Fire-and-forget: nunca bloquea ni lanza al llamador.
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;
      if (__DEV__) console.log('[track]', event, props);
      await supabase.from('analytics_events').insert({ user_id: userId, event, props });
    } catch {
      // Ignorado a propósito.
    }
  })();
}

const appOpenKvKey = (userId: string, day: string) => `app_open_tracked:${userId}:${day}`;

/**
 * Registra `app_open` una vez por usuario y **día natural** (hora local del
 * dispositivo, mismo criterio de "día" que usa el resto del diario —
 * `todayISO()`), no una vez por arranque del proceso.
 *
 * Auditoría de medición de sesiones/retención: la versión anterior era un
 * flag en memoria (`let appOpenTracked = false`), que sólo se reseteaba al
 * matar y reabrir la app — infravaloraba D7/D30 para cualquier usuario que
 * simplemente la dejara en segundo plano varios días sin cerrarla del todo.
 * Persistido en SQLite (mismo patrón que `trackFirstFoodLoggedOnce`, mismo
 * motivo: no depender de una consulta de red para decidir si ya se contó
 * hoy) esto sobrevive a reinicios del proceso, cambios de pestaña y ciclos
 * de segundo plano/primer plano dentro del mismo día — sólo un cambio real
 * de día (o de usuario) genera un evento nuevo. Mismo evento de siempre
 * (`app_open`), sin payload y sin cambiar la tabla: sólo cambia CUÁNDO se
 * considera "ya contado hoy".
 */
export async function trackAppOpenOnce(userId: string): Promise<void> {
  try {
    const key = appOpenKvKey(userId, todayISO());
    const already = await kvGet<boolean>(key);
    if (already) return;
    await kvSet(key, true);
    track('app_open');
  } catch {
    // Ignorado a propósito — igual que track().
  }
}

const firstFoodLoggedKvKey = (userId: string) => `first_food_logged_tracked:${userId}`;

/**
 * Registra `first_food_logged` una única vez por usuario — el hito de
 * activación real (no "abrió la app", sino "la usó de verdad"). Persistido
 * en SQLite local (mismo patrón que `last_user_id` en `authStore.ts`), no en
 * Supabase, para no necesitar una consulta de red antes de cada entrada
 * guardada: encaja con el resto del diario, que escribe local primero.
 * Deliberadamente por usuario, no por sesión — si sólo fuera un flag en
 * memoria, un usuario real reabriendo la app en días distintos dispararía el
 * evento de "primera vez" una y otra vez.
 */
export async function trackFirstFoodLoggedOnce(userId: string): Promise<void> {
  try {
    const already = await kvGet<boolean>(firstFoodLoggedKvKey(userId));
    if (already) return;
    await kvSet(firstFoodLoggedKvKey(userId), true);
    track('first_food_logged');
  } catch {
    // Ignorado a propósito — igual que track().
  }
}
