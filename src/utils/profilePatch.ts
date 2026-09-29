/**
 * Columnas de `profiles` que el cliente NUNCA escribe, y el saneador que lo
 * garantiza en el borde de la app.
 *
 * Esta es la capa 3 (cliente) de la defensa en profundidad descrita en
 * `docs/SEGURIDAD-SUSCRIPCION.md`. Las dos capas que de verdad protegen el dato
 * viven en Postgres (privilegios por columna + trigger), porque el cliente es
 * código que el atacante controla: aquí no se "protege" nada, sólo se evita que
 * la app envíe columnas que el servidor va a rechazar, y se deja constancia en
 * el sistema de tipos de cuál es el invariante.
 *
 * La fuente de verdad del entitlement Pro es el webhook de RevenueCat, que
 * escribe con `service_role`.
 */
import type { Profile } from '@/types';

/**
 * Columnas de suscripción. Sólo `service_role` puede escribirlas.
 * Si alguna vez hay que añadir otra, hay que añadirla también a la allowlist
 * invertida de `supabase/migrations/20260901000000_protect_subscription_columns.sql`.
 */
export const ENTITLEMENT_PROFILE_COLUMNS = [
  'subscription_tier',
  'subscription_expires_at',
  'stripe_customer_id',
] as const;

/** Identidad de la fila: la fija el alta, nunca se actualiza. */
export const IMMUTABLE_PROFILE_COLUMNS = ['id', 'created_at'] as const;

/** Todo lo que el cliente no puede enviar en un UPDATE de perfil. */
export const CLIENT_READONLY_PROFILE_COLUMNS = [
  ...ENTITLEMENT_PROFILE_COLUMNS,
  ...IMMUTABLE_PROFILE_COLUMNS,
] as const;

export type ClientReadonlyProfileColumn = (typeof CLIENT_READONLY_PROFILE_COLUMNS)[number];

/**
 * Los campos del perfil que el cliente sí puede actualizar.
 *
 * Al usarse como tipo del parámetro de `updateProfile()`, pasar
 * `subscription_tier` pasa a ser un error de compilación: `npm run typecheck`
 * es, de hecho, uno de los tests de regresión de este P0.
 */
export type EditableProfileFields = Omit<Profile, ClientReadonlyProfileColumn>;

const READONLY_SET: ReadonlySet<string> = new Set(CLIENT_READONLY_PROFILE_COLUMNS);

/**
 * Elimina de un patch cualquier columna que el cliente no deba escribir.
 *
 * Devuelve también las columnas descartadas para poder avisar en desarrollo:
 * que esto llegue a descartar algo significa que hay una llamada mal escrita,
 * no que estemos deteniendo un ataque (un atacante no pasa por este código).
 */
export function sanitizeProfilePatch<T extends Record<string, unknown>>(
  patch: T
): { patch: Partial<EditableProfileFields>; removed: string[] } {
  const safe: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const key of Object.keys(patch)) {
    if (READONLY_SET.has(key)) removed.push(key);
    else safe[key] = patch[key];
  }

  return { patch: safe as Partial<EditableProfileFields>, removed };
}
