/**
 * Recordatorio diario para registrar comidas — contextual (P1 de retención):
 * no debe sonar si el usuario ya registró algo hoy, y SIEMPRE debe quedar
 * una notificación futura pendiente para el próximo día que corresponda.
 *
 * Restricción real de expo-notifications que condiciona todo este diseño:
 * una notificación local programada la dispara el sistema operativo, no
 * nuestro JS — en el momento del disparo no podemos ejecutar código para
 * decidir "¿hace falta esto de verdad?". Así que en vez de un trigger
 * `DAILY` recurrente (que sólo se puede cancelar entero, nunca "sólo hoy"),
 * este módulo programa siempre UNA ÚNICA notificación de tipo `DATE` para
 * el próximo momento válido, y la recalcula por completo cada vez que
 * ocurre un evento que la app SÍ controla:
 *   - activar el recordatorio o cambiar la hora (`scheduleDailyReminder`),
 *   - guardar una comida (`onMealLogged`, llamado desde `diaryStore.addEntry`),
 *   - abrir la app (`resyncDailyReminder`, llamado desde `RootNavigator`).
 *
 * Con un trigger `DAILY`, cancelarlo al registrar una comida apagaba el
 * recordatorio PARA SIEMPRE si nadie volvía a abrir la app — exactamente lo
 * contrario de lo que este recordatorio existe para hacer. Con `DATE`, cada
 * vez que se recalcula el estado se programa de inmediato la ocurrencia
 * siguiente (mañana, si hoy ya está resuelto), así que un usuario que
 * registra la cena y no vuelve a abrir la app sigue teniendo un recordatorio
 * real esperándole mañana.
 *
 * `computeNextOccurrence` es la única pieza de decisión de fecha/hora, pura
 * y sin efectos — toma `now` explícito para poder testear "antes/después de
 * la hora" sin depender del reloj real. Todo lo demás pasa siempre por
 * `applyState`, que cancela-y-reprograma con el mismo `identifier`: nunca
 * puede quedar más de una notificación pendiente.
 *
 * `enabled` (activado/desactivado por el usuario) y "hay una notificación
 * programada ahora mismo" son DOS cosas distintas y se guardan por
 * separado: la primera es la preferencia del usuario (KV `reminder_enabled`,
 * fuente de verdad del toggle en Perfil, NUNCA derivada de si hay algo
 * programado); la segunda es sólo el resultado de aplicar esa preferencia
 * al estado actual.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { kvGet, kvSet, mirrorList } from '@/db/database';
import { daysBetween, todayISO } from '@/utils/dates';
import type { FoodLogEntry } from '@/types';

const REMINDER_ID = 'daily-log-reminder';
const HOUR_KV_KEY = 'reminder_hour';
const ENABLED_KV_KEY = 'reminder_enabled';
export const DEFAULT_REMINDER_HOUR = 20;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Recordatorios',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#2f5d41',
    });
  }
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

/** Racha tal cual vive en `profiles` — sólo los dos campos que necesita el
 * texto del recordatorio, para no acoplar este módulo al tipo `Profile`
 * completo ni a ningún store. */
export interface ReminderStreakInfo {
  streakCount: number;
  lastLogDate: string | null;
}

/**
 * ¿Sigue "viva" la racha a día de hoy, a efectos de este texto? Válida si
 * hay racha (>0) y el último registro fue hoy o ayer — cualquier hueco mayor
 * significa que ya se rompió (`update_streak` la habría reiniciado a 1 en
 * cuanto se registre de nuevo, pero hasta entonces no hay nada que destacar).
 * Nunca inventa una racha que no sea la real de `profiles`.
 */
function isStreakValidToday(streak: ReminderStreakInfo | null | undefined): boolean {
  if (!streak || streak.streakCount <= 0 || !streak.lastLogDate) return false;
  return daysBetween(streak.lastLogDate, todayISO()) <= 1;
}

/**
 * Texto del recordatorio — personalizado con la racha real cuando sigue
 * viva; neutro en cualquier otro caso (sin racha, racha rota, o sin datos).
 * Pura, sin efectos: fácil de testear sin tocar notificaciones ni KV.
 */
export function reminderBody(streak?: ReminderStreakInfo | null): string {
  if (isStreakValidToday(streak)) {
    const n = (streak as ReminderStreakInfo).streakCount;
    return `Llevas ${n} ${n === 1 ? 'día' : 'días'} seguidos registrando. ¿Sigues hoy?`;
  }
  return '¿Has registrado tus comidas de hoy?';
}

async function hasFoodLoggedToday(userId: string): Promise<boolean> {
  const rows = await mirrorList<FoodLogEntry>('food_log', userId, todayISO());
  return rows.length > 0;
}

/**
 * Próxima ocurrencia válida del recordatorio, pura — la única función que
 * decide "hoy o mañana". `now` es explícito (no `new Date()` por defecto)
 * para que los tests controlen "antes/después de la hora" sin mockear el
 * reloj del sistema.
 *
 *   - Si ya se registró algo hoy: siempre mañana a `hour` — hoy está
 *     resuelto, sin importar si la hora ya pasó o no.
 *   - Si no: hoy a `hour` si ese instante todavía no ha pasado; si ya pasó,
 *     mañana a `hour`.
 */
export function computeNextOccurrence(hour: number, loggedToday: boolean, now: Date): Date {
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  const alreadyPassed = target.getTime() <= now.getTime();
  // `setDate`/`setHours` operan en hora local de pared, así que sumar un día
  // así es correcto incluso al cruzar un cambio de horario de verano — a
  // diferencia de sumar 24h en milisegundos, que no lo sería.
  if (loggedToday || alreadyPassed) target.setDate(target.getDate() + 1);
  return target;
}

/**
 * Cancela lo que hubiera programado y programa la ÚNICA notificación
 * siguiente (hoy o mañana, según `computeNextOccurrence`) con el texto que
 * corresponda. Cancelar-y-programar con el mismo `identifier` siempre
 * garantiza que nunca queda más de una pendiente — repetible sin efecto
 * acumulativo: llamar esto varias veces seguidas sólo reemplaza la anterior.
 */
async function applyState(userId: string, hour: number, streak?: ReminderStreakInfo | null): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);

  const loggedToday = await hasFoodLoggedToday(userId);
  const when = computeNextOccurrence(hour, loggedToday, new Date());

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: 'VegeTrack 🌱',
      body: reminderBody(streak),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
      channelId: 'reminders',
    },
  });
}

/**
 * Activa el recordatorio para `userId` a `hour` — programa de inmediato la
 * próxima ocurrencia válida (hoy si aún no hay nada registrado y no ha
 * pasado la hora; mañana en cualquier otro caso). También se usa para
 * cambiar la hora estando ya activado: siempre recalcula desde cero con la
 * hora nueva.
 */
export async function scheduleDailyReminder(
  userId: string,
  hour: number,
  streak?: ReminderStreakInfo | null
): Promise<boolean> {
  const ok = await requestNotificationPermission();
  if (!ok) return false;

  await kvSet(ENABLED_KV_KEY, true);
  await kvSet(HOUR_KV_KEY, hour);
  try {
    await applyState(userId, hour, streak);
  } catch {
    // No romper el toggle por un fallo puntual leyendo el espejo local o
    // programando la notificación — la preferencia ya quedó guardada, y el
    // próximo resync (abrir la app, guardar una comida) lo reintentará.
  }
  return true;
}

/** Cancela cualquier notificación pendiente, sin tocar la preferencia
 * activado/desactivado. */
export async function cancelDailyReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
}

/** Desactiva el recordatorio por completo: cancela lo pendiente y borra la
 * preferencia — a partir de aquí `getReminderHour()` vuelve a `null` y
 * ningún resync futuro lo reprograma hasta que el usuario lo reactive. */
export async function disableDailyReminder(): Promise<void> {
  await cancelDailyReminder();
  await kvSet(ENABLED_KV_KEY, false);
}

/**
 * `null` si el recordatorio está desactivado; si no, la hora configurada.
 * La fuente de verdad es la preferencia guardada (`reminder_enabled`), NO
 * si hay una notificación programada ahora mismo.
 */
export async function getReminderHour(): Promise<number | null> {
  const enabled = await kvGet<boolean>(ENABLED_KV_KEY);
  if (!enabled) return null;
  return (await kvGet<number>(HOUR_KV_KEY)) ?? DEFAULT_REMINDER_HOUR;
}

/**
 * Se llama al guardar una comida (`diaryStore.addEntry`). Si la entrada es
 * de HOY, recalcula el estado de inmediato — como ya hay algo registrado
 * hoy, esto siempre reprograma la notificación para MAÑANA (nunca la deja
 * sin ninguna pendiente): un usuario que registra la cena y no vuelve a
 * abrir la app sigue teniendo un recordatorio real esperándole al día
 * siguiente. Repetible sin efecto — registrar varias comidas el mismo día
 * sólo vuelve a programar la misma ocurrencia de mañana.
 */
export async function onMealLogged(
  userId: string,
  date: string,
  streak?: ReminderStreakInfo | null
): Promise<void> {
  if (date !== todayISO()) return;
  try {
    const enabled = await kvGet<boolean>(ENABLED_KV_KEY);
    if (!enabled) return;
    const hour = (await kvGet<number>(HOUR_KV_KEY)) ?? DEFAULT_REMINDER_HOUR;
    await applyState(userId, hour, streak);
  } catch {
    // Best-effort — un fallo aquí nunca debe afectar al guardado de la
    // comida, que ya se ha confirmado antes de llegar a esta llamada.
  }
}

/**
 * Reevalúa el recordatorio para HOY. Pensado para engancharse a eventos que
 * la app sí controla — abrir la app es el principal, también sirve tras un
 * cambio de configuración — nunca desde el disparo de la propia
 * notificación. No hace nada si el recordatorio está desactivado. Repetible
 * sin efecto (mismo `identifier`, cancelar-antes-de-programar) — abrir la
 * app varias veces el mismo día nunca duplica ni acumula nada.
 */
export async function resyncDailyReminder(
  userId: string,
  streak?: ReminderStreakInfo | null
): Promise<void> {
  try {
    const enabled = await kvGet<boolean>(ENABLED_KV_KEY);
    if (!enabled) return;
    const hour = (await kvGet<number>(HOUR_KV_KEY)) ?? DEFAULT_REMINDER_HOUR;
    await applyState(userId, hour, streak);
  } catch {
    // Best-effort — un fallo aquí no debe bloquear el arranque de la app.
  }
}
