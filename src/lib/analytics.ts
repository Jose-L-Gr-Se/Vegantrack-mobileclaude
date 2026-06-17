/**
 * Analítica de producto, mínima y propia. Inserta eventos del embudo en
 * Supabase (`analytics_events`) para poder medir activación, retención y
 * conversión — hoy la app no medía nada. Es "best-effort": si falla, no rompe
 * el flujo del usuario. Sustituible por PostHog más adelante sin tocar las
 * llamadas a `track()`.
 */
import { supabase } from '@/lib/supabase';

export type AnalyticsEvent =
  | 'app_open'
  | 'photo_scan_started'
  | 'photo_scan_success'
  | 'photo_scan_quota_blocked'
  | 'photo_scan_error'
  | 'photo_entry_saved'
  | 'paywall_viewed'
  | 'checkout_opened';

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
