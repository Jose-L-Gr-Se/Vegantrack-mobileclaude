/**
 * P1 de sincronización (Fase 1, ver auditoría) — clasificación mínima de
 * errores de sync, SÓLO a efectos de observabilidad. Nunca decide si se
 * reintenta o no: eso lo sigue decidiendo `flushPending` exactamente igual
 * que antes para los dos casos (una operación pendiente nunca se pierde por
 * un error, sea transitorio o inesperado).
 *
 * postgrest-js deja `code` vacío específicamente cuando el fallo es del lado
 * del cliente — fetch nunca llegó a recibir respuesta del servidor (sin red,
 * DNS, timeout, abort) — y nunca lo usa para errores reales de
 * Postgres/PostgREST, que siempre traen un SQLSTATE de 5 caracteres o un
 * código `PGRST*` propio (ver `@supabase/postgrest-js/src/PostgrestBuilder.ts`:
 * "we don't populate code/hint for client-side network errors"). Por eso
 * `!code` es la señal fiable de "no hubo respuesta del servidor"; cualquier
 * otro caso es un error real (RLS, constraint, etc.) que sí merece
 * observabilidad, aunque no cambie el comportamiento de reintento.
 */
export interface SyncOpError {
  code?: string | null;
  message?: string | null;
}

/** true = probablemente de red/transitorio (no llegó respuesta del servidor). */
export function isTransientSyncError(error: SyncOpError | null | undefined): boolean {
  if (!error) return false;
  return !error.code;
}
