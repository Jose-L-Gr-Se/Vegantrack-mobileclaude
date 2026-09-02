/**
 * Observabilidad de producción: único punto de contacto con el SDK de crash
 * reporting (Sentry). P0 de CLAUDE.md §14 / PRODUCT.md: "crash-free sessions"
 * es una métrica north-star y hoy no era medible — antes de esto no había ni
 * un ErrorBoundary ni un solo reporte de error en toda la app.
 *
 * Política de datos (obligatoria, no negociable — ver CLAUDE.md §17/§18):
 *   - Nunca comida, peso, macros, micronutrientes, suplementos ni texto libre.
 *   - Nunca tokens de sesión, contraseñas ni secretos.
 *   - Sin analítica de comportamiento (eso ya existe, por separado, en
 *     `src/lib/analytics.ts` — este fichero no debe acercarse a esa función).
 *   - `extra` sólo admite valores primitivos a propósito: hace estructuralmente
 *     difícil colar aquí un objeto de comida, receta o perfil completo.
 *   - Sin screenshots, sin grabación de pantalla, sin jerarquía de vistas,
 *     sin PII por defecto, sin breadcrumbs de consola (por si algún
 *     `console.log` futuro imprime datos de usuario).
 *   - No se envía ningún identificador de usuario todavía: no es necesario
 *     para detectar crashes, y evita tener que decidir aquí qué cuenta como
 *     "seguro". Si en el futuro hace falta para soporte, añadir sólo el uuid
 *     técnico (nunca email) con `Sentry.setUser({ id })`.
 */
import * as Sentry from '@sentry/react-native';

type PrimitiveExtra = Record<string, string | number | boolean>;

let initialized = false;

/**
 * Llamar una única vez, lo antes posible en el arranque (`index.ts`, antes de
 * `registerRootComponent`). Sin DSN configurado, no hace nada: el resto de
 * este módulo sigue siendo seguro de llamar (no-op), así que el arranque
 * nunca depende de que Sentry esté disponible.
 */
export function initErrorReporting(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (initialized || !dsn) return;
  try {
    Sentry.init({
      dsn,
      debug: __DEV__,
      environment: __DEV__ ? 'development' : 'production',
      // Esto es sólo detección de errores, no analítica de comportamiento ni
      // rendimiento: sin trazas, sin screenshots, sin jerarquía de vistas.
      tracesSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      sendDefaultPii: false,
      beforeBreadcrumb(breadcrumb) {
        // Ningún console.log/warn/error debe poder llegar a Sentry como
        // breadcrumb: es la vía más fácil por la que se colaría un dato de
        // usuario sin que quien lo escribió estuviera pensando en esto.
        if (breadcrumb.category === 'console') return null;
        return breadcrumb;
      },
      beforeSend(event) {
        // Red de seguridad adicional: nunca reenviar cuerpo/cookies de
        // peticiones HTTP, aunque una integración futura los capturase.
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
        }
        return event;
      },
    });
    initialized = true;
  } catch {
    // Nunca debe impedir el arranque de la app.
  }
}

/** Sólo para tests / diagnóstico manual. */
export function isErrorReportingEnabled(): boolean {
  return initialized;
}

/**
 * Reporta un error manualmente desde cualquier punto del código. Seguro de
 * llamar siempre: si el SDK no está inicializado (sin DSN, `initErrorReporting`
 * no invocado, o falló), no hace nada — nunca lanza ni bloquea al llamador.
 *
 * `context.extra` sólo admite string/number/boolean: no pases aquí un
 * alimento, receta, suplemento o perfil — sólo identificadores técnicos
 * (p. ej. `{ tag: 'sync_flush', extra: { pendingCount: 3 } }`).
 */
export function reportError(error: unknown, context?: { tag?: string; extra?: PrimitiveExtra }): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[errorReporting]', context?.tag ?? 'error', error);
  }
  if (!initialized) return;
  try {
    Sentry.captureException(error, {
      tags: context?.tag ? { source: context.tag } : undefined,
      extra: context?.extra,
    });
  } catch {
    // Nunca debe romper al llamador.
  }
}

/**
 * Breadcrumb técnico mínimo para dar contexto al siguiente error de la
 * sesión (p. ej. `addBreadcrumb('sync_retry_exhausted', { attempts: 3 })`).
 * Nunca texto libre de usuario. Seguro de llamar sin SDK inicializado.
 */
export function addBreadcrumb(message: string, data?: PrimitiveExtra): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({ category: 'app', message, data, level: 'info' });
  } catch {
    // Nunca debe romper al llamador.
  }
}
