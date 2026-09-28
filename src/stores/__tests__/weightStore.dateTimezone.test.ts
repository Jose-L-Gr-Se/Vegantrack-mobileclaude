/**
 * Auditoría transversal de fechas y concepto de "hoy" — `weightStore`
 * mezclaba el día LOCAL (`WeightLog.date`, siempre YYYY-MM-DD local en toda
 * la app: ver `todayISO()`/`toISODate()` en `@/utils/dates`, usados por
 * `diaryStore`, reminders, etc.) con el día en UTC al calcular los cortes de
 * "últimos N días" (`getChartData`) y "hace un año" (`fetchLogs`), usando
 * `new Date().toISOString().split('T')[0]` en vez del helper local ya
 * establecido en el resto de la app.
 *
 * En un huso horario adelantado a UTC (España, UTC+1 en invierno / +2 en
 * verano), durante la 1ª-2ª hora tras la medianoche local, `.toISOString()`
 * todavía devuelve el día ANTERIOR en UTC — el corte de "últimos 7 días" se
 * movía un día entero respecto al "hoy" que ve el usuario en el resto de la
 * app (Diario, Dashboard, Tendencias), todos basados en `todayISO()`.
 *
 * El entorno de test corre siempre en UTC (no respeta `process.env.TZ` en
 * caliente dentro de este runtime de Jest/Node), así que en vez de intentar
 * cambiar la zona horaria del proceso, se simula un huso horario adelantado
 * a UTC interceptando `Date.prototype.toISOString` para que devuelva, para
 * cualquier instante, el equivalente `hours` horas ANTES — exactamente lo
 * que ocurre de verdad en Europe/Madrid: los getters LOCALES nativos
 * (`getFullYear`/`getMonth`/`getDate`/`setDate`, que aquí SÍ representan la
 * hora "local" simulada porque el proceso corre en UTC sin desfase) siguen
 * intactos, y sólo la conversión a UTC (`toISOString`) queda desplazada —
 * exactamente la relación real entre hora local y UTC en un huso adelantado.
 */
import type * as WeightStoreModule from '@/stores/weightStore';
import type { WeightLog } from '@/types';

jest.mock('expo-sqlite', () => require('@/db/__tests__/expoSqliteTestAdapter'));

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ updateProfile: jest.fn().mockResolvedValue({ error: null }) }) },
}));

const REAL_TO_ISO_STRING = Date.prototype.toISOString;

/** Simula un huso horario `hours` horas por delante de UTC (p. ej. 1 para
 *  Europe/Madrid en invierno) durante toda la duración de `fn` — incluido
 *  el trabajo asíncrono que haga, no sólo su invocación síncrona — sin
 *  depender de la TZ real del proceso. Ver cabecera del fichero. */
async function withUtcAheadOffset<T>(hours: number, fn: () => Promise<T> | T): Promise<T> {
  const spy = jest
    .spyOn(Date.prototype, 'toISOString')
    .mockImplementation(function (this: Date) {
      return REAL_TO_ISO_STRING.call(new Date(this.getTime() - hours * 3_600_000));
    });
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

function log(id: string, date: string, weightKg: number): WeightLog {
  return { id, user_id: 'user-1', date, weight_kg: weightKg, note: null, created_at: '' };
}

function freshWeightStore(): typeof WeightStoreModule {
  jest.resetModules();
  mockFrom.mockReset();
  return require('@/stores/weightStore') as typeof WeightStoreModule;
}

describe('weightStore — cortes de fecha ("últimos N días", "hace un año") no deben mezclar UTC con el día local', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('getChartData(7) a las 00:30 "hora local" del 15 de enero de 2026 no debe incluir el 7 de enero (un día antes del corte real)', async () => {
    jest.useFakeTimers();
    // "Ahora" local: 2026-01-15 00:30. Con un huso UTC+1 (Madrid en
    // invierno), el equivalente UTC sería 2026-01-14T23:30 — con el bug
    // (corte calculado vía .toISOString()), el corte de "últimos 7 días" se
    // computaba sobre el 14 de enero, dejando entrar un día de más: el 7.
    jest.setSystemTime(new Date(2026, 0, 15, 0, 30));

    const { useWeightStore } = freshWeightStore();
    useWeightStore.setState({
      logs: [log('a', '2026-01-07', 70), log('b', '2026-01-08', 71), log('c', '2026-01-15', 72)],
    });

    const dates = await withUtcAheadOffset(1, () => useWeightStore.getState().getChartData(7).map((p) => p.date));

    // El corte correcto de "últimos 7 días" desde el 15 de enero (local) es
    // el 8 de enero — el 7 de enero debe quedar FUERA del rango.
    expect(dates).not.toContain('2026-01-07');
    expect(dates).toEqual(['2026-01-08', '2026-01-15']);
  });

  it('caso normal (sin desfase UTC/local): getChartData(7) sigue funcionando con normalidad', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 12, 0));

    const { useWeightStore } = freshWeightStore();
    useWeightStore.setState({
      logs: [log('a', '2026-01-07', 70), log('b', '2026-01-08', 71), log('c', '2026-01-15', 72)],
    });

    const dates = useWeightStore.getState().getChartData(7).map((p) => p.date);
    expect(dates).toEqual(['2026-01-08', '2026-01-15']);
  });

  it('fetchLogs() pide a Supabase el corte de "hace un año" en fecha LOCAL, no UTC', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 0, 30)); // misma medianoche "local" que arriba

    const { useWeightStore } = freshWeightStore();

    let gteArgs: [string, string] | null = null;
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          gte: (col: string, val: string) => {
            gteArgs = [col, val];
            return { order: () => Promise.resolve({ data: [], error: null }) };
          },
        }),
      }),
    }));

    await withUtcAheadOffset(1, () => useWeightStore.getState().fetchLogs('user-1'));

    // "Hace un año" desde el 15 de enero de 2026 (local) es el 15 de enero
    // de 2025 — no el 14, que es lo que daría `.toISOString()` a esa hora.
    expect(gteArgs).toEqual(['date', '2025-01-15']);
  });
});
