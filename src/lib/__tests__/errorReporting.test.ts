/**
 * Utilidad centralizada de crash reporting — P0 de observabilidad
 * (CLAUDE.md §14). Cubre exactamente lo que puede probarse sin red real:
 * que nunca rompe al llamador y que el payload que sale hacia el SDK está
 * acotado a lo que se le pasa explícitamente (nunca datos nutricionales).
 *
 * No se prueba que Sentry reciba de verdad un evento en producción — eso no
 * es testeable desde aquí y no es el objetivo de esta suite.
 */

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// `reportError` también escribe en consola en modo dev a propósito (ver el
// módulo); silenciado aquí para no ensuciar la salida de la suite.
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

function freshModuleWithoutDsn() {
  jest.resetModules();
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@/lib/errorReporting') as typeof import('@/lib/errorReporting');
}

function freshModuleInitialized() {
  jest.resetModules();
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://fake-key@o0.ingest.sentry.io/0';
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@/lib/errorReporting') as typeof import('@/lib/errorReporting');
  mod.initErrorReporting();
  return mod;
}

const ORIGINAL_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

afterEach(() => {
  process.env.EXPO_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
  jest.clearAllMocks();
});

describe('sin SDK inicializado (sin DSN configurado)', () => {
  it('initErrorReporting no lanza y deja el reporting desactivado', () => {
    const { initErrorReporting, isErrorReportingEnabled } = freshModuleWithoutDsn();
    expect(() => initErrorReporting()).not.toThrow();
    expect(isErrorReportingEnabled()).toBe(false);
  });

  it('reportError no lanza y no llama al SDK', () => {
    const { reportError } = freshModuleWithoutDsn();
    expect(() => reportError(new Error('boom'))).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('addBreadcrumb no lanza y no llama al SDK', () => {
    const { addBreadcrumb } = freshModuleWithoutDsn();
    expect(() => addBreadcrumb('evento_tecnico', { count: 1 })).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe('con SDK inicializado', () => {
  it('isErrorReportingEnabled pasa a true tras init() con DSN', () => {
    const { isErrorReportingEnabled } = freshModuleInitialized();
    expect(isErrorReportingEnabled()).toBe(true);
  });

  it('si Sentry.init() lanza, no rompe el arranque (queda como no inicializado)', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://fake-key@o0.ingest.sentry.io/0';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    Sentry.init.mockImplementationOnce(() => {
      throw new Error('SDK nativo no disponible');
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initErrorReporting, isErrorReportingEnabled } = require('@/lib/errorReporting');
    expect(() => initErrorReporting()).not.toThrow();
    expect(isErrorReportingEnabled()).toBe(false);
  });

  it('reportError reenvía el error y sólo tag/extra — nada más se añade al payload', () => {
    const { reportError } = freshModuleInitialized();
    const err = new Error('fallo de render');
    reportError(err, { tag: 'render_error', extra: { componentStack: 'App > Diary', retryCount: 2 } });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [reportedError, hint] = Sentry.captureException.mock.calls[0];
    expect(reportedError).toBe(err);
    expect(hint).toEqual({
      tags: { source: 'render_error' },
      extra: { componentStack: 'App > Diary', retryCount: 2 },
    });
  });

  it('reportError sin contexto no lanza (tags/extra quedan undefined, nada se infiere)', () => {
    const { reportError } = freshModuleInitialized();
    expect(() => reportError(new Error('sin contexto'))).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: undefined,
      extra: undefined,
    });
  });

  it('si Sentry.captureException lanza, reportError no propaga el error al llamador', () => {
    const { reportError } = freshModuleInitialized();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    Sentry.captureException.mockImplementationOnce(() => {
      throw new Error('transporte caído');
    });
    expect(() => reportError(new Error('y'))).not.toThrow();
  });

  it('addBreadcrumb reenvía sólo message/data bajo categoría "app", nada implícito', () => {
    const { addBreadcrumb } = freshModuleInitialized();
    addBreadcrumb('sync_retry_exhausted', { attempts: 3 });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'app',
      message: 'sync_retry_exhausted',
      data: { attempts: 3 },
      level: 'info',
    });
  });

  it('si Sentry.addBreadcrumb lanza, no propaga el error al llamador', () => {
    const { addBreadcrumb } = freshModuleInitialized();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    Sentry.addBreadcrumb.mockImplementationOnce(() => {
      throw new Error('transporte caído');
    });
    expect(() => addBreadcrumb('x')).not.toThrow();
  });
});

describe('política de datos del payload manual', () => {
  it('el tipo de `extra` sólo admite primitivos: no hay forma de pasar un objeto de comida/receta/perfil sin que tsc lo rechace', () => {
    // Esto es un test de contrato, no de runtime — Jest no comprueba tipos.
    // `extra` está tipado como Record<string, string|number|boolean> a
    // propósito, así que documentamos la garantía llamando con exactamente
    // el tipo de valores que cualquier llamador real está obligado a usar.
    const { reportError } = freshModuleInitialized();
    expect(() =>
      reportError(new Error('z'), { tag: 'test', extra: { a: 'texto', b: 1, c: true } })
    ).not.toThrow();
  });
});
