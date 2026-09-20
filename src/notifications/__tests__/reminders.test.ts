/**
 * P1 de retención — recordatorio diario contextual, con una única
 * notificación FUTURA (trigger `DATE`, no `DAILY` recurrente).
 *
 * Motivo del rediseño: con un `DAILY` recurrente, cancelarlo al registrar
 * una comida apagaba el recordatorio para siempre si el usuario no volvía a
 * abrir la app — exactamente lo contrario de para qué existe. Con `DATE`,
 * cada evento que la app controla (activar, guardar una comida, abrir la
 * app, cambiar la hora) recalcula y programa de inmediato la ÚNICA
 * ocurrencia siguiente (hoy o mañana), así que siempre queda algo
 * pendiente — la prueba central de este fichero es exactamente esa.
 *
 * No se puede ejecutar JS en el instante en que suena una notificación
 * programada, así que estos tests comprueban lo que sí se puede controlar:
 * qué decide el código en esos eventos, nunca el disparo real.
 *
 * SQLite real (adaptador de test) para `kv` y el espejo de `food_log` —
 * seedeado directamente con `mirrorUpsert`, sin pasar por `diaryStore` ni
 * por Supabase. `expo-notifications` se mockea entero. El reloj del sistema
 * se controla con fake timers para poder probar "antes/después de la hora"
 * de forma determinista.
 */
jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mockSetNotificationChannelAsync = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancelScheduledNotificationAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  AndroidImportance: { DEFAULT: 'default' },
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

const REMINDER_ID = 'daily-log-reminder';
const USER_ID = 'user-1';
const HOUR = 20;
// Miércoles cualquiera — 10:00 (antes de las 20:00) y 21:00 (después).
const BEFORE_HOUR = new Date(2026, 8, 16, 10, 0, 0, 0);
const AFTER_HOUR = new Date(2026, 8, 16, 21, 0, 0, 0);

function freshReminders() {
  jest.resetModules();
  const reminders = require('@/notifications/reminders') as typeof import('@/notifications/reminders');
  const db = require('@/db/database') as typeof import('@/db/database');
  const dates = require('@/utils/dates') as typeof import('@/utils/dates');
  return { reminders, db, dates };
}

let seedCounter = 0;
async function seedFoodToday(
  db: typeof import('@/db/database'),
  dates: typeof import('@/utils/dates'),
  userId = USER_ID
) {
  seedCounter += 1;
  await db.mirrorUpsert(
    'food_log',
    { id: `seed-${seedCounter}`, user_id: userId, date: dates.todayISO(), meal_type: 'lunch', payload: {} },
    true
  );
}

/** La fecha (`Date`) de la última llamada a `scheduleNotificationAsync`, o
 * `undefined` si no se ha programado ninguna. */
function lastScheduledDate(): Date | undefined {
  const calls = mockScheduleNotificationAsync.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][0].trigger.date as Date;
}

function sameInstant(a: Date | undefined, b: Date): boolean {
  return !!a && a.getTime() === b.getTime();
}

beforeEach(() => {
  mockSetNotificationChannelAsync.mockReset().mockResolvedValue(undefined);
  mockGetPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockRequestPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockCancelScheduledNotificationAsync.mockReset().mockResolvedValue(undefined);
  mockScheduleNotificationAsync.mockReset().mockResolvedValue('id');
  jest.useFakeTimers();
  jest.setSystemTime(BEFORE_HOUR);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('computeNextOccurrence — decisión pura de fecha/hora', () => {
  it('sin comida y la hora aún no ha pasado: hoy a esa hora', () => {
    const { reminders } = freshReminders();
    const now = new Date(2026, 8, 16, 10, 0, 0);
    const expected = new Date(2026, 8, 16, HOUR, 0, 0, 0);
    expect(reminders.computeNextOccurrence(HOUR, false, now).getTime()).toBe(expected.getTime());
  });

  it('sin comida y la hora ya pasó: mañana a esa hora', () => {
    const { reminders } = freshReminders();
    const now = new Date(2026, 8, 16, 21, 0, 0);
    const expected = new Date(2026, 8, 17, HOUR, 0, 0, 0);
    expect(reminders.computeNextOccurrence(HOUR, false, now).getTime()).toBe(expected.getTime());
  });

  it('con comida ya registrada hoy: siempre mañana, aunque la hora no haya pasado', () => {
    const { reminders } = freshReminders();
    const now = new Date(2026, 8, 16, 10, 0, 0);
    const expected = new Date(2026, 8, 17, HOUR, 0, 0, 0);
    expect(reminders.computeNextOccurrence(HOUR, true, now).getTime()).toBe(expected.getTime());
  });

  it('con comida ya registrada hoy y la hora también pasada: igualmente mañana', () => {
    const { reminders } = freshReminders();
    const now = new Date(2026, 8, 16, 21, 0, 0);
    const expected = new Date(2026, 8, 17, HOUR, 0, 0, 0);
    expect(reminders.computeNextOccurrence(HOUR, true, now).getTime()).toBe(expected.getTime());
  });
});

describe('scheduleDailyReminder (activar) — programa la ocurrencia correcta según hoy', () => {
  it('sin comida y antes de la hora → programa HOY', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 16, HOUR, 0, 0, 0))).toBe(true);
  });

  it('sin comida y después de la hora → programa MAÑANA', async () => {
    jest.setSystemTime(AFTER_HOUR);
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('con comida ya registrada hoy → programa MAÑANA (aunque no haya pasado la hora)', async () => {
    const { reminders, db, dates } = freshReminders();
    await seedFoodToday(db, dates);
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('activa la preferencia (reminder_enabled) aunque hoy no se programe para hoy mismo', async () => {
    const { reminders } = freshReminders();
    const ok = await reminders.scheduleDailyReminder(USER_ID, HOUR);
    expect(ok).toBe(true);
    await expect(reminders.getReminderHour()).resolves.toBe(HOUR);
  });
});

describe('onMealLogged — registrar comida hoy SIEMPRE deja algo pendiente para mañana', () => {
  it('con el recordatorio de hoy pendiente, registrar una comida lo cancela y programa el de mañana', async () => {
    const { reminders, db, dates } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR); // sin comida aún → queda programado para HOY
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 16, HOUR, 0, 0, 0))).toBe(true);
    mockCancelScheduledNotificationAsync.mockClear();

    // El diaryStore real ya habría escrito la entrada en el espejo local
    // ANTES de llamar a onMealLogged — se reproduce aquí igual.
    await seedFoodToday(db, dates);
    await reminders.onMealLogged(USER_ID, dates.todayISO());

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(REMINDER_ID);
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('DEMOSTRACIÓN CENTRAL: registrar comida hoy y no volver a abrir la app deja, aun así, un recordatorio real programado para mañana', async () => {
    const { reminders, db, dates } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    mockScheduleNotificationAsync.mockClear();

    // Única acción real de un usuario: guardar una comida hoy (que primero
    // escribe en el espejo local, igual que diaryStore.addEntry) y notificar
    // a reminders. Nada más — ni se reabre la app, ni se llama a
    // resyncDailyReminder. Si el bug original (cancelar un DAILY sin
    // reprogramar nada) siguiera presente, aquí no habría ninguna llamada a
    // scheduleNotificationAsync y el usuario se quedaría sin recordatorio
    // para siempre.
    await seedFoodToday(db, dates);
    await reminders.onMealLogged(USER_ID, dates.todayISO());

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const scheduled = lastScheduledDate();
    expect(scheduled).toBeDefined();
    // Tiene que ser una fecha FUTURA real (mañana), no "nada".
    expect(scheduled!.getTime()).toBeGreaterThan(BEFORE_HOUR.getTime());
    expect(sameInstant(scheduled, new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('una entrada de un día distinto a hoy no toca el recordatorio', async () => {
    const { reminders, dates } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    mockCancelScheduledNotificationAsync.mockClear();
    mockScheduleNotificationAsync.mockClear();

    await reminders.onMealLogged(USER_ID, dates.addDays(dates.todayISO(), -3));

    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('registrar varias comidas el mismo día no acumula ni rompe nada — sigue habiendo una sola, la de mañana', async () => {
    const { reminders, db, dates } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    await seedFoodToday(db, dates); // la primera comida del día

    await reminders.onMealLogged(USER_ID, dates.todayISO());
    await seedFoodToday(db, dates); // una segunda comida
    await reminders.onMealLogged(USER_ID, dates.todayISO());
    await seedFoodToday(db, dates); // y una tercera
    await reminders.onMealLogged(USER_ID, dates.todayISO());

    expect(mockCancelScheduledNotificationAsync.mock.calls.length).toBe(
      mockScheduleNotificationAsync.mock.calls.length
    ); // cancelar-antes-de-programar, siempre en pareja
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('con el recordatorio desactivado, no programa nada', async () => {
    const { reminders, dates } = freshReminders();
    await reminders.onMealLogged(USER_ID, dates.todayISO());
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('resyncDailyReminder (abrir la app) — recalcula sin duplicar', () => {
  it('con comida ya registrada hoy: sólo queda mañana', async () => {
    const { reminders, db, dates } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR); // sin comida → hoy
    await seedFoodToday(db, dates);

    await reminders.resyncDailyReminder(USER_ID);

    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('sin comida y antes de la hora: queda hoy', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);

    await reminders.resyncDailyReminder(USER_ID); // reabrir la app el mismo día, aún sin comida

    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 16, HOUR, 0, 0, 0))).toBe(true);
  });

  it('sin comida y después de la hora: queda mañana', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR); // programado para hoy a las 20:00

    jest.setSystemTime(AFTER_HOUR); // se abre la app más tarde, sin haber comido
    await reminders.resyncDailyReminder(USER_ID);

    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, HOUR, 0, 0, 0))).toBe(true);
  });

  it('ejecutado repetidamente, nunca acumula más de una notificación', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    mockScheduleNotificationAsync.mockClear();
    mockCancelScheduledNotificationAsync.mockClear();

    await reminders.resyncDailyReminder(USER_ID);
    await reminders.resyncDailyReminder(USER_ID);
    await reminders.resyncDailyReminder(USER_ID);

    // Cada resync cancela-antes-de-programar con el MISMO identifier.
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(3);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
    for (const [call] of mockScheduleNotificationAsync.mock.calls) {
      expect(call.identifier).toBe(REMINDER_ID);
    }
  });

  it('con el recordatorio desactivado, no hace nada', async () => {
    const { reminders } = freshReminders();
    await reminders.resyncDailyReminder(USER_ID);
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('cambiar la hora — cancela y programa una única notificación con la hora nueva', () => {
  it('cambiar de 20 a 9: sólo queda una notificación, con la hora nueva', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, 20);
    mockScheduleNotificationAsync.mockClear();
    mockCancelScheduledNotificationAsync.mockClear();

    await reminders.scheduleDailyReminder(USER_ID, 9); // mismo flujo que "cambiar hora" en ProfileScreen

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 17, 9, 0, 0, 0))).toBe(true);
    await expect(reminders.getReminderHour()).resolves.toBe(9);
  });
});

describe('desactivar y volver a activar', () => {
  it('desactivar deja cero notificaciones pendientes', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    mockCancelScheduledNotificationAsync.mockClear();

    await reminders.disableDailyReminder();

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    await expect(reminders.getReminderHour()).resolves.toBeNull();
  });

  it('volver a activar después de desactivar programa una única notificación correcta', async () => {
    const { reminders } = freshReminders();
    await reminders.scheduleDailyReminder(USER_ID, HOUR);
    await reminders.disableDailyReminder();
    mockScheduleNotificationAsync.mockClear();
    mockCancelScheduledNotificationAsync.mockClear();

    const ok = await reminders.scheduleDailyReminder(USER_ID, HOUR);

    expect(ok).toBe(true);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(sameInstant(lastScheduledDate(), new Date(2026, 8, 16, HOUR, 0, 0, 0))).toBe(true);
    await expect(reminders.getReminderHour()).resolves.toBe(HOUR);
  });
});

describe('reminderBody — texto con racha válida / sin racha', () => {
  it('con racha > 0 y último registro AYER, personaliza el texto con los días', () => {
    const { reminders, dates } = freshReminders();
    const yesterday = dates.addDays(dates.todayISO(), -1);
    expect(reminders.reminderBody({ streakCount: 3, lastLogDate: yesterday })).toBe(
      'Llevas 3 días seguidos registrando. ¿Sigues hoy?'
    );
  });

  it('con racha de 1 día, usa el singular', () => {
    const { reminders, dates } = freshReminders();
    const yesterday = dates.addDays(dates.todayISO(), -1);
    expect(reminders.reminderBody({ streakCount: 1, lastLogDate: yesterday })).toBe(
      'Llevas 1 día seguidos registrando. ¿Sigues hoy?'
    );
  });

  it('sin racha (streakCount = 0), texto neutro', () => {
    const { reminders, dates } = freshReminders();
    const yesterday = dates.addDays(dates.todayISO(), -1);
    expect(reminders.reminderBody({ streakCount: 0, lastLogDate: yesterday })).toBe(
      '¿Has registrado tus comidas de hoy?'
    );
  });

  it('con racha ya rota (último registro hace más de un día), texto neutro', () => {
    const { reminders, dates } = freshReminders();
    const longAgo = dates.addDays(dates.todayISO(), -5);
    expect(reminders.reminderBody({ streakCount: 4, lastLogDate: longAgo })).toBe(
      '¿Has registrado tus comidas de hoy?'
    );
  });

  it('sin datos de racha (undefined o null), texto neutro', () => {
    const { reminders } = freshReminders();
    expect(reminders.reminderBody(undefined)).toBe('¿Has registrado tus comidas de hoy?');
    expect(reminders.reminderBody(null)).toBe('¿Has registrado tus comidas de hoy?');
  });

  it('el texto con racha válida también se usa en la notificación programada de verdad', async () => {
    const { reminders, dates } = freshReminders();
    const yesterday = dates.addDays(dates.todayISO(), -1);
    await reminders.scheduleDailyReminder(USER_ID, HOUR, { streakCount: 5, lastLogDate: yesterday });
    const [[call]] = mockScheduleNotificationAsync.mock.calls;
    expect(call.content.body).toContain('5 días');
  });
});
