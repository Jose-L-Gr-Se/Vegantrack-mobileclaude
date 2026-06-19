/**
 * Recordatorio diario para registrar comidas.
 * La PWA usa Web Push con un cron en servidor; en nativo no hace falta
 * servidor: usamos notificaciones locales programadas (expo-notifications),
 * que funcionan sin conexión y sobreviven a reinicios del dispositivo.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { kvGet, kvSet } from '@/db/database';
import i18n from '@/i18n';

const REMINDER_ID = 'daily-log-reminder';
const KV_KEY = 'reminder_hour';
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
      name: i18n.t('reminders.channelName'),
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#2f5d41',
    });
  }
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

export async function scheduleDailyReminder(hour: number): Promise<boolean> {
  const ok = await requestNotificationPermission();
  if (!ok) return false;

  await cancelDailyReminder();
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: i18n.t('reminders.notifTitle'),
      body: i18n.t('reminders.notifBody'),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
      channelId: 'reminders',
    },
  });
  await kvSet(KV_KEY, hour);
  return true;
}

export async function cancelDailyReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
}

export async function getReminderHour(): Promise<number | null> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (!scheduled.some((n) => n.identifier === REMINDER_ID)) return null;
  return (await kvGet<number>(KV_KEY)) ?? DEFAULT_REMINDER_HOUR;
}
