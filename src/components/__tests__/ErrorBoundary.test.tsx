/**
 * ErrorBoundary raíz — P0 de observabilidad (ver CLAUDE.md §14).
 *
 * No usamos @testing-library/react-native aquí: en este repo, con React 19 +
 * RNTL 14, `render()`/`renderHook` no son estables (precedente ya establecido
 * en otras suites de esta app). `react-test-renderer` + `act()` sí funciona
 * de forma fiable para renderizar árboles reales, así que se usa aquí
 * directamente — es la primera suite de este repo que renderiza un
 * componente en vez de sólo probar funciones puras.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { reportError } from '@/lib/errorReporting';

// `@/components/ErrorBoundary` -> `@/theme` -> `@/stores/themeStore` ->
// `@/db/database` -> `expo-sqlite`, cuyo módulo real intenta cargar
// `expo-asset` (no resoluble en este entorno de test, ver nota en el
// informe de entrega). `database.ts` sólo llama a SQLite de forma perezosa
// dentro de `getDb()`, así que un mock vacío es seguro: nada de este test
// ejercita SQLite.
jest.mock('expo-sqlite', () => ({}));

jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
  initErrorReporting: jest.fn(),
  isErrorReportingEnabled: jest.fn(() => false),
}));

const mockReportError = reportError as jest.Mock;

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom de prueba');
  return <Text>Hijo OK</Text>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReportError.mockClear();
    // React (y nuestro propio `if (__DEV__) console.error(...)` en
    // errorReporting) escriben en consola al capturar el error de prueba;
    // silenciado a propósito para no ensuciar la salida del test.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renderiza los children normalmente cuando no hay error', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <Text>Contenido normal</Text>
        </ErrorBoundary>
      );
    });
    expect(renderer!.root.findByType(Text).props.children).toBe('Contenido normal');
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('un child que lanza error muestra el fallback, no una pantalla en blanco', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>
      );
    });
    const texts = renderer!.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain('Algo ha ido mal');
    // Nunca un stack trace ni el mensaje técnico del error para el usuario.
    expect(texts.join(' ')).not.toMatch(/boom de prueba|at Boom|\.tsx:\d+/);
  });

  it('reporta el error (no lo oculta en silencio) con un tag identificable, sin volcar el error crudo como "extra"', () => {
    act(() => {
      TestRenderer.create(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>
      );
    });
    expect(mockReportError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = mockReportError.mock.calls[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect(context.tag).toBe('render_error');
    // El componentStack son sólo nombres de componentes (técnico), nunca
    // datos de usuario.
    expect(typeof context.extra.componentStack).toBe('string');
  });

  it('el fallback permite reintentar: al pulsar, se vuelven a montar los children', () => {
    // El fallo era transitorio (p. ej. un dato en caché corrupto que ya se
    // limpió) — Boom lee un flag mutable *fuera* de sus props para que el
    // remount que hace ErrorBoundary al reintentar vea el estado actual, en
    // vez de depender de que algún padre externo se re-renderice a tiempo.
    const transientFailure = { active: true };
    function Boom() {
      if (transientFailure.active) throw new Error('boom de prueba');
      return <Text>Hijo OK</Text>;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      );
    });
    expect(renderer!.root.findAllByType(Text).map((n) => n.props.children)).toContain('Algo ha ido mal');

    transientFailure.active = false;

    // `Button`/`Pressable` no son fiables de localizar por tipo aquí (dos
    // instancias del módulo `react-native` conviven en este entorno de test
    // y `findByType` compara por referencia) — se localiza el control
    // pulsable por su prop `onPress`, que es una forma más robusta y no
    // depende de qué componente concreto lo implemente por debajo.
    const [pressable] = renderer!.root.findAll(
      (n) => typeof n.type === 'function' && typeof n.props.onPress === 'function'
    );
    act(() => {
      pressable.props.onPress();
    });

    const textsAfterRetry = renderer!.root.findAllByType(Text).map((n) => n.props.children);
    expect(textsAfterRetry).toContain('Hijo OK');
    expect(textsAfterRetry).not.toContain('Algo ha ido mal');
  });
});
