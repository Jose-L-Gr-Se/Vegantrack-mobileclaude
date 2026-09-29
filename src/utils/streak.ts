/**
 * Racha EFECTIVA al leer. `profiles.streak_count` es la racha que TERMINA en
 * `last_log_date` (la deja `update_streak` al registrar/borrar); no se
 * recalcula por el mero paso del tiempo, así que una racha rota seguiría
 * guardada con su valor hasta el siguiente registro. Esta función decide, al
 * mostrarla, si sigue viva: el último día registrado fue hoy o ayer
 * (`daysBetween <= 1`, la misma regla que ya usaban los recordatorios).
 * Cualquier hueco mayor significa que ya se rompió → 0.
 *
 * Pura y sin efectos: no muta el perfil.
 */
import { daysBetween } from '@/utils/dates';

export function effectiveStreak(
  streakCount: number | null | undefined,
  lastLogDate: string | null | undefined,
  today: string
): number {
  if (!streakCount || streakCount <= 0 || !lastLogDate) return 0;
  return daysBetween(lastLogDate, today) <= 1 ? streakCount : 0;
}
