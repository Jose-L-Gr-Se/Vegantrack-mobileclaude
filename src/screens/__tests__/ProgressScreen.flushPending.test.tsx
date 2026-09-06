/**
 * P1 de sincronización — Fase 3 (ver auditoría): en ProgressScreen,
 * `flushPending` de weightStore se engancha junto a `fetchLogs` en el
 * `useFocusEffect` ya existente. Mismo enfoque que
 * `DiaryScreen.flushPending.test.ts` — componente real, sólo se mockean los
 * stores/hooks y la navegación.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ProgressScreen } from '@/screens/ProgressScreen';
import { useAuthStore } from '@/stores/authStore';
import { useWeightStore } from '@/stores/weightStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
}));

// useAuthStore se llama aquí con selector (`useAuthStore((s) => s.user)`),
// a diferencia de DiaryScreen — el mock debe soportar ambas formas.
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/weightStore', () => ({ useWeightStore: jest.fn() }));

const mockFetchLogs = jest.fn();

function baseWeightStoreMock(overrides: Record<string, unknown> = {}) {
  return {
    logs: [],
    fetchLogs: mockFetchLogs,
    flushPending: jest.fn().mockResolvedValue(undefined),
    addLog: jest.fn(),
    deleteLog: jest.fn(),
    getChartData: () => [],
    getStats: () => null,
    ...overrides,
  };
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderProgressScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProgressScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchLogs.mockResolvedValue(undefined);

  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' } })
  );
  (useWeightStore as unknown as jest.Mock).mockReturnValue(baseWeightStoreMock());
});

describe('ProgressScreen — Fase 3 del P1 de sincronización', () => {
  it('entrar en Progreso (foco) dispara fetchLogs Y flushPending, para el mismo usuario', () => {
    const mockFlushPending = jest.fn().mockResolvedValue(undefined);
    (useWeightStore as unknown as jest.Mock).mockReturnValue(baseWeightStoreMock({ flushPending: mockFlushPending }));

    renderProgressScreen();

    expect(mockFetchLogs).toHaveBeenCalledWith('user-1');
    expect(mockFlushPending).toHaveBeenCalledWith('user-1');
  });

  it('sin usuario autenticado → ni fetchLogs ni flushPending se disparan', () => {
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ user: null })
    );
    const mockFlushPending = jest.fn();
    (useWeightStore as unknown as jest.Mock).mockReturnValue(baseWeightStoreMock({ flushPending: mockFlushPending }));

    renderProgressScreen();

    expect(mockFetchLogs).not.toHaveBeenCalled();
    expect(mockFlushPending).not.toHaveBeenCalled();
  });
});
