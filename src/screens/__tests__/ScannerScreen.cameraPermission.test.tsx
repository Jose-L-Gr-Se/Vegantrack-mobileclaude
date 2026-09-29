/**
 * Auditoría de permisos y degradación en Android — `ScannerScreen` sólo
 * volvía a pedir el permiso de cámara automáticamente cuando
 * `canAskAgain === true`; si Android ya lo había denegado de forma
 * PERMANENTE (`granted: false, canAskAgain: false` — "No preguntar de nuevo"
 * marcado, o segunda denegación en Android 11+), la pantalla seguía
 * ofreciendo el mismo botón "Conceder permiso". En ese estado no hace nada
 * observable: `requestPermission()` en Android resuelve de inmediato con el
 * mismo `granted: false`, sin mostrar ningún diálogo del sistema — el
 * usuario quedaba en un callejón sin salida dentro de la propia app, sin
 * ningún camino hacia Ajustes (a diferencia de `useMealPhoto`, que para
 * cámara/galería sí informa al menos de ir a Ajustes en el texto del Alert).
 *
 * Además, `useCameraPermissions()` (expo-modules-core `createPermissionHook`)
 * sólo comprueba el permiso al MONTAR el componente. Si el usuario sale a
 * Ajustes con `Linking.openSettings()` y lo concede allí, al volver la MISMA
 * instancia de `ScannerScreen` sigue montada con el estado antiguo — sin un
 * resync explícito al volver a primer plano, seguiría mostrando la pantalla
 * de permiso denegado indefinidamente.
 *
 * `expo-camera` se mockea con una reimplementación mínima pero fiel de
 * `useCameraPermissions()` (misma forma que `PermissionsHook.ts` de
 * expo-modules-core: comprueba al montar sin pedir, expone tanto
 * `requestPermission` como `getPermission`) para poder controlar la
 * respuesta de Android/Expo en cada escenario sin depender de módulos
 * nativos reales. `react-native` se mockea con un Proxy que sólo sustituye
 * `AppState`/`Linking` (mismo patrón que `appStateSync.test.ts`): un spread
 * (`{ ...actual }`) dispara getters perezosos de RN (`FlatList`/`DevMenu`) y
 * rompe el arranque.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ScannerScreen } from '@/screens/ScannerScreen';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: {} }),
}));

interface PermissionResponse {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
  expires: 'never';
}

let mockGetPermission: jest.Mock<Promise<PermissionResponse>, []>;
let mockRequestPermission: jest.Mock<Promise<PermissionResponse>, []>;

jest.mock('expo-camera', () => {
  const ReactActual = require('react');
  return {
    CameraView: () => null,
    useCameraPermissions: () => {
      const [status, setStatus] = ReactActual.useState(null);
      const getPermission = ReactActual.useCallback(async () => {
        const res = await mockGetPermission();
        setStatus(res);
        return res;
      }, []);
      const requestPermission = ReactActual.useCallback(async () => {
        const res = await mockRequestPermission();
        setStatus(res);
        return res;
      }, []);
      ReactActual.useEffect(() => {
        void getPermission();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return [status, requestPermission, getPermission];
    },
  };
});

let registeredAppStateCallback: ((state: string) => void) | undefined;
const mockAppStateRemove = jest.fn();
const mockAppStateAddEventListener = jest.fn((_event: string, cb: (state: string) => void) => {
  registeredAppStateCallback = cb;
  return { remove: mockAppStateRemove };
});
const mockOpenSettings = jest.fn().mockResolvedValue(undefined);

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'AppState') {
        return {
          ...target.AppState,
          addEventListener: (...args: [string, (state: string) => void]) => mockAppStateAddEventListener(...args),
        };
      }
      if (prop === 'Linking') {
        return { ...target.Linking, openSettings: (...args: unknown[]) => mockOpenSettings(...args) };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
});

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function granted(): PermissionResponse {
  return { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };
}
function deniedCanAskAgain(): PermissionResponse {
  return { granted: false, canAskAgain: true, status: 'denied', expires: 'never' };
}
function deniedPermanently(): PermissionResponse {
  return { granted: false, canAskAgain: false, status: 'denied', expires: 'never' };
}

function hasButtonTitled(renderer: TestRenderer.ReactTestRenderer, title: string): boolean {
  return (
    renderer.root.findAll(
      (n) =>
        typeof n.type === 'function' &&
        (n.type as { name?: string }).name === 'Button' &&
        typeof n.props.onPress === 'function' &&
        n.props.title === title
    ).length > 0
  );
}

function findButtonByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  const [button] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      typeof n.props.onPress === 'function' &&
      n.props.title === title
  );
  if (!button) throw new Error(`No se encontró el botón "${title}"`);
  return button;
}

/** Deja resolver la cadena de promesas encadenadas (getPermission al montar
 *  → posible auto-requestPermission → setStatus → re-render) sin depender de
 *  temporizadores reales. */
async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ScannerScreen />
      </SafeAreaProvider>
    );
    await flush();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  registeredAppStateCallback = undefined;
  mockOpenSettings.mockResolvedValue(undefined);
});

describe('ScannerScreen — permiso concedido', () => {
  it('con la cámara ya concedida, no pide nada y no muestra la pantalla de permiso', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(granted());
    mockRequestPermission = jest.fn();
    const renderer = await renderScreen();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(hasButtonTitled(renderer, 'Conceder permiso')).toBe(false);
    expect(hasButtonTitled(renderer, 'Abrir Ajustes')).toBe(false);
  });
});

describe('ScannerScreen — denegado con canAskAgain: true', () => {
  it('reintenta automáticamente (comportamiento existente) y ofrece "Conceder permiso", no "Abrir Ajustes"', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedCanAskAgain());
    // El diálogo nativo real no se resuelve hasta que el usuario responde —
    // se deja "colgado" a propósito para comprobar el único disparo
    // automático que corresponde a "se está mostrando el diálogo ahora
    // mismo", sin que una resolución instantánea del mock dispare una
    // segunda vuelta del efecto que no ocurriría en Android real.
    mockRequestPermission = jest.fn(() => new Promise<PermissionResponse>(() => {}));
    const renderer = await renderScreen();

    // Auto-reintento ya existente: al ver canAskAgain:true, pide el permiso
    // sin que el usuario tenga que tocar nada — no debe romperse con el fix.
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(hasButtonTitled(renderer, 'Conceder permiso')).toBe(true);
    expect(hasButtonTitled(renderer, 'Abrir Ajustes')).toBe(false);
  });

  it('tocar "Conceder permiso" vuelve a pedirlo, sin abrir Ajustes', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedCanAskAgain());
    mockRequestPermission = jest.fn().mockResolvedValue(deniedCanAskAgain());
    const renderer = await renderScreen();
    mockRequestPermission.mockClear();

    await act(async () => {
      findButtonByTitle(renderer, 'Conceder permiso').props.onPress();
      await flush();
    });

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });
});

describe('ScannerScreen — denegado PERMANENTEMENTE (canAskAgain: false)', () => {
  it('NO vuelve a pedir el permiso automáticamente (Android ya no mostraría el diálogo)', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedPermanently());
    mockRequestPermission = jest.fn();
    await renderScreen();

    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('ofrece "Abrir Ajustes" en vez de "Conceder permiso" — ya no hay un callejón sin salida', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedPermanently());
    mockRequestPermission = jest.fn();
    const renderer = await renderScreen();

    expect(hasButtonTitled(renderer, 'Conceder permiso')).toBe(false);
    expect(hasButtonTitled(renderer, 'Abrir Ajustes')).toBe(true);
  });

  it('tocar "Abrir Ajustes" abre los Ajustes del sistema y no vuelve a pedir el permiso in-app', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedPermanently());
    mockRequestPermission = jest.fn();
    const renderer = await renderScreen();

    await act(async () => {
      findButtonByTitle(renderer, 'Abrir Ajustes').props.onPress();
      await flush();
    });

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });
});

describe('ScannerScreen — volver de Ajustes sin desmontar la pantalla', () => {
  it('al volver a primer plano tras conceder el permiso en Ajustes, revisa de nuevo y ya no pide ir a Ajustes', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedPermanently());
    mockRequestPermission = jest.fn();
    const renderer = await renderScreen();
    expect(hasButtonTitled(renderer, 'Abrir Ajustes')).toBe(true);

    // El usuario concede el permiso en Ajustes y vuelve — la pantalla NUNCA
    // se desmonta (sólo pasa a background y vuelve a active).
    mockGetPermission.mockResolvedValue(granted());
    await act(async () => {
      registeredAppStateCallback?.('active');
      await flush();
    });

    expect(mockGetPermission).toHaveBeenCalledTimes(2); // montaje + resync al volver
    expect(hasButtonTitled(renderer, 'Abrir Ajustes')).toBe(false);
    expect(hasButtonTitled(renderer, 'Conceder permiso')).toBe(false);
  });

  it('si sigue sin concederlo, volver a primer plano no pide el permiso automáticamente ni cambia el CTA', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(deniedPermanently());
    mockRequestPermission = jest.fn();
    const renderer = await renderScreen();

    await act(async () => {
      registeredAppStateCallback?.('active');
      await flush();
    });

    expect(hasButtonTitled(renderer, 'Abrir Ajustes')).toBe(true);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('se desuscribe del listener de AppState al desmontar', async () => {
    mockGetPermission = jest.fn().mockResolvedValue(granted());
    mockRequestPermission = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
          <ScannerScreen />
        </SafeAreaProvider>
      );
      await flush();
    });

    act(() => renderer.unmount());

    expect(mockAppStateRemove).toHaveBeenCalledTimes(1);
  });
});
