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
  | 'photo_result_viewed'
  | 'photo_result_discarded'
  | 'photo_entry_saved'
  | 'photo_entry_save_failed'
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

/**
 * Best-effort por defecto: nunca lanza al llamador, y quien no le interesa
 * el resultado puede seguir llamándola sin `await` exactamente como antes
 * (sigue arrancando de inmediato y nunca deja una rechazada sin capturar).
 * Devuelve si el insert se ha confirmado de verdad — lo necesita
 * `trackFirstFoodLoggedOnce` (fiabilidad del hito de activación) para no
 * marcar un hito que en realidad no llegó a registrarse; el resto de
 * eventos (`app_open`, `photo_entry_saved`, etc.) no cambian: siguen sin
 * comprobar este valor.
 */
export async function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return false;
    if (__DEV__) console.log('[track]', event, props);
    const { error } = await supabase.from('analytics_events').insert({ user_id: userId, event, props });
    return !error;
  } catch {
    // Ignorado a propósito.
    return false;
  }
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
 * Usuarios con un intento de confirmar el hito en curso ahora mismo (el
 * insert de `track()` todavía no ha resuelto). Ver la explicación de la
 * carrera más abajo.
 */
const firstFoodLoggedInFlight = new Set<string>();

/**
 * Registra `first_food_logged` una única vez por usuario — el hito de
 * activación real (no "abrió la app", sino "la usó de verdad"). El kv local
 * (mismo patrón que `last_user_id` en `authStore.ts`) sólo se marca como
 * "confirmado" cuando el insert en `analytics_events` ha tenido éxito de
 * verdad — antes se marcaba ANTES de conocer el resultado, así que registrar
 * la primera comida sin conexión guardaba la comida bien pero perdía el
 * evento para siempre (nunca se reintentaba, porque el kv ya decía "hecho").
 * Si `track()` falla (sin red, sin sesión…), el kv no se toca: la próxima
 * vez que se llame a esta función — de forma normal, en un `addEntry`
 * posterior, sin ningún mecanismo de reintento nuevo que construir — se
 * vuelve a intentar desde cero.
 *
 * Persistido en SQLite local, no en Supabase, para no necesitar una consulta
 * de red antes de cada entrada guardada: encaja con el resto del diario, que
 * escribe local primero. Deliberadamente por usuario, no por sesión — si
 * sólo fuera un flag en memoria, un usuario real reabriendo la app en días
 * distintos dispararía el evento de "primera vez" una y otra vez.
 *
 * Importante — el insert en sí sigue sin bloquear a quien llama: igual que
 * antes de este arreglo, `diaryStore.addEntry` espera esta función como
 * parte de guardar una entrada, y esa espera debe seguir siendo sólo lectura
 * local (kv), nunca una espera de red — si no, la primera comida de un
 * usuario nuevo tardaría en guardarse lo que tarde el POST a
 * `analytics_events`, rompiendo el guardado offline-first. Por eso el envío
 * real (`track()` + el `kvSet` que lo confirma) se lanza en segundo plano
 * SIN esperarlo, y la función devuelve en cuanto sabe, por el kv local, que
 * el hito no estaba confirmado todavía.
 *
 * Concurrencia: dos `addEntry()` casi simultáneos para el mismo usuario (p.
 * ej. `copyDayEntries` añadiendo varias entradas en bucle, o dos pantallas
 * distintas guardando a la vez) podrían, sin ninguna protección, leer el kv
 * como "todavía no marcado" antes de que ninguna de las dos llegara a
 * confirmarlo — las dos llamarían a `track('first_food_logged')`, duplicando
 * el evento. La protección es `firstFoodLoggedInFlight`: se reclama de forma
 * SÍNCRONA, como primera línea de la función, antes de cualquier `await` —
 * JS es de un único hilo, así que dos llamadas "a la vez" (p. ej.
 * `Promise.all([...])`) se ejecutan una detrás de otra hasta su primer punto
 * de espera; la segunda ve siempre la reclama de la primera y nunca llega a
 * comprobar el kv por su cuenta. La reclama se libera sólo cuando el envío
 * en segundo plano termina (éxito o fallo), así que una llamada que llegue
 * mientras el primer intento sigue en vuelo tampoco duplica el insert;
 * cuando el envío ya ha terminado, una llamada posterior es libre de
 * reintentar si el anterior falló.
 *
 * Devuelve `true` sólo para la llamada que, según el kv local, le
 * corresponde el hito — `diaryStore.addEntry` lo usa para decidir si
 * corresponde ofrecer el recordatorio diario tras la primera comida
 * (auditoría de activación); no implica que el insert ya se haya confirmado,
 * sólo que se ha lanzado. `false` si ya estaba confirmado o si había otra
 * llamada en vuelo: ante la duda, nunca se trata una entrada como "la
 * primera" dos veces.
 */
export async function trackFirstFoodLoggedOnce(userId: string): Promise<boolean> {
  if (firstFoodLoggedInFlight.has(userId)) return false;
  firstFoodLoggedInFlight.add(userId);

  let already: boolean | null;
  try {
    already = await kvGet<boolean>(firstFoodLoggedKvKey(userId));
  } catch {
    firstFoodLoggedInFlight.delete(userId);
    return false;
  }
  if (already) {
    firstFoodLoggedInFlight.delete(userId);
    return false;
  }

  // Envío en segundo plano, deliberadamente sin `await`: ver la nota sobre
  // por qué `addEntry()` no debe esperar a la red, más arriba.
  void (async () => {
    try {
      const inserted = await track('first_food_logged');
      if (inserted) await kvSet(firstFoodLoggedKvKey(userId), true);
    } catch {
      // Ignorado a propósito — igual que track(). El kv no queda marcado,
      // así que una llamada posterior podrá reintentarlo.
    } finally {
      firstFoodLoggedInFlight.delete(userId);
    }
  })();

  return true;
}
