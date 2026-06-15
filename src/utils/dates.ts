/** Helpers de fechas. Convención: la BD usa siempre ISO YYYY-MM-DD. */
import type { MealType } from '@/types';

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function formatDateHuman(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Hoy';
  if (iso === addDays(today, -1)) return 'Ayer';
  if (iso === addDays(today, 1)) return 'Mañana';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Comida sugerida por la hora local.
 *
 *   00:00–05:00 → snack (toma nocturna)
 *   05:00–10:30 → desayuno
 *   10:30–15:30 → comida
 *   15:30–19:30 → snack
 *   19:30–24:00 → cena
 *
 * El usuario siempre puede cambiarla; esto solo evita que el selector
 * arranque en "Comida" a las 9 de la mañana o a las 9 de la noche.
 */
export function suggestedMealNow(now: Date = new Date()): MealType {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5) return 'snack';
  if (h < 10.5) return 'breakfast';
  if (h < 15.5) return 'lunch';
  if (h < 19.5) return 'snack';
  return 'dinner';
}
