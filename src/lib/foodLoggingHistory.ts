/**
 * Señal de PRODUCTO "este usuario ha registrado alguna comida alguna vez"
 * (`has_logged_food:<userId>`), separada a propósito de la analítica.
 *
 * `first_food_logged_tracked` (en `analytics.ts`) responde otra pregunta —
 * "¿se confirmó el evento `first_food_logged` en `analytics_events`?" — y
 * sólo se marca si ese insert tiene éxito: un primer registro sin red no la
 * marca. Esta señal, en cambio:
 * - se escribe en local en cuanto una comida queda guardada en el
 *   dispositivo (`diaryStore.addEntry`, único punto por el que pasa
 *   cualquier forma de registrar), sin red y sin depender de la analítica;
 * - también se escribe cuando el diario carga un día que ya tiene entradas
 *   de este usuario (`diaryStore.fetchEntries`): es la misma evidencia, y
 *   así quien ya registraba antes de que existiera esta señal queda marcado
 *   sin esperar a su próximo registro;
 * - sobrevive al borrado de todo `food_log` (nada la borra al borrar
 *   entradas), a diferencia de `profile.last_log_date`;
 * - se limpia con el resto de datos de la cuenta al cerrar sesión o eliminar
 *   la cuenta (`authStore`), igual que `last_user_id`.
 *
 * Es local (KV de SQLite, mismo patrón que `reminder_offer_shown:<userId>`):
 * no viaja a otros dispositivos ni sobrevive a una reinstalación. Por eso el
 * Resumen la combina con `profile.last_log_date`, nunca la usa sola.
 */
import { kvGet, kvSet } from '@/db/database';

const hasLoggedFoodKvKey = (userId: string) => `has_logged_food:${userId}`;

/** Usuarios ya marcados en esta sesión de la app: evita reescribir el KV en
 *  cada `addEntry`/`fetchEntries`. Sólo es una caché de la escritura. */
const markedThisSession = new Set<string>();

/** Best-effort: nunca lanza. Idempotente. */
export async function markHasLoggedFood(userId: string): Promise<void> {
  if (markedThisSession.has(userId)) return;
  try {
    await kvSet(hasLoggedFoodKvKey(userId), true);
    markedThisSession.add(userId);
  } catch {
    // Sin SQLite no hay nada que persistir; se reintentará en el próximo registro.
  }
}

/** `false` ante cualquier error: nunca afirma algo que no pudo leer. */
export async function hasLoggedFood(userId: string): Promise<boolean> {
  try {
    return (await kvGet<boolean>(hasLoggedFoodKvKey(userId))) === true;
  } catch {
    return false;
  }
}

/** Cierre de sesión / eliminación de cuenta. Best-effort: nunca lanza. */
export async function clearHasLoggedFood(userId: string): Promise<void> {
  markedThisSession.delete(userId);
  try {
    await kvSet(hasLoggedFoodKvKey(userId), null);
  } catch {
    // Ignorado a propósito, igual que el resto de limpiezas de cuenta.
  }
}
