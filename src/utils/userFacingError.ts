/**
 * Traduce un error técnico (mensaje de Supabase, fetch, excepción) a un
 * mensaje de usuario genérico y calmado. El detalle técnico no debe llegar
 * nunca a la UI (CLAUDE.md §5: "avoid raw technical error messages") — el
 * llamador es responsable de registrarlo aparte (log/Sentry) si lo necesita.
 *
 * Deliberadamente simple: no intenta mapear mensajes concretos a variantes
 * de copy, porque eso reabre la puerta a filtrar detalle técnico por partes
 * ("column X violates...") en cuanto un mensaje no encaje en el mapa.
 */
export const GENERIC_SAVE_ERROR_MESSAGE =
  'No se pudo guardar. Comprueba tu conexión e inténtalo de nuevo.';

export function toUserFacingError(_technicalMessage: string | null | undefined): string {
  return GENERIC_SAVE_ERROR_MESSAGE;
}
