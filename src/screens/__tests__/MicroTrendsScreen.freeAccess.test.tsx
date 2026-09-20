/**
 * Nuevo contrato Free/Pro de Tendencias de micros (auditoría de experiencia
 * de retorno 3/7/14 días): Free ve 7 días; 30 y 90 siguen siendo Pro.
 *
 * Cubre exactamente los escenarios pedidos:
 * - Free + 7 días -> permitido.
 * - Free + 30 días -> bloqueado (ProModal/paywall).
 * - Free + 90 días -> bloqueado (ProModal/paywall).
 * - Pro + 7/30/90 -> permitido.
 * - Navegación inicial de Free -> aterriza en 7 días, sin bloqueo.
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { MicroTrendsScreen } from '@/screens/MicroTrendsScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { usePro } from '@/hooks/usePro';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Line: () => null, Polyline: () => null, Circle: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const mockProModal = jest.fn((_props: unknown) => null);
jest.mock('@/components/ProModal', () => ({ ProModal: (props: unknown) => mockProModal(props) }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <MicroTrendsScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function selectPeriod(renderer: TestRenderer.ReactTestRenderer, label: '7D' | '30D' | '90D') {
  let node = renderer.root.findAllByType(Text).find((n) => n.props.children === label)!;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

/** Botón "Ver planes Pro" del bloque de bloqueo — sólo existe cuando el
 * rango elegido no está permitido para el usuario actual. */
function findUpgradeButton(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .find((n) => n.props.children === 'Ver planes Pro');
}

const POINTS = [
  {
    date: '2026-09-07',
    micros: {
      vitamin_b12_mcg: { value: 2, pct: 0.8, hasEntries: true, confidence: 'high' },
      iron_mg: { value: 10, pct: 0.6, hasEntries: true, confidence: 'high' },
      zinc_mg: { value: 5, pct: 0.5, hasEntries: true, confidence: 'high' },
      calcium_mg: { value: 500, pct: 0.5, hasEntries: true, confidence: 'high' },
      vitamin_d_mcg: { value: 5, pct: 0.5, hasEntries: true, confidence: 'high' },
      omega3_g: { value: 1, pct: 0.5, hasEntries: true, confidence: 'high' },
    },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' }, profile: { sex: 'female' } });
  (useDiaryStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ getMicroTrends: jest.fn().mockResolvedValue(POINTS) })
  );
});

describe('MicroTrendsScreen — contrato Free 7 días / Pro 7-30-90', () => {
  it('Free + 7 días: permitido — sin bloqueo, sin ProModal, sin paywall_viewed', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();

    expect(findUpgradeButton(renderer)).toBeUndefined();
    expect(mockProModal).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
  });

  it('Free + 30 días: bloqueado — paywall_viewed medido y bloque de upgrade visible', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();

    selectPeriod(renderer, '30D');

    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'trends' });
    const upgrade = findUpgradeButton(renderer);
    expect(upgrade).toBeDefined();

    // El botón abre el ProModal existente (mismo flujo que antes).
    let node = upgrade!;
    while (node.parent && typeof node.props.onPress !== 'function') node = node.parent;
    act(() => node.props.onPress());
    expect(mockProModal).toHaveBeenCalledWith(expect.objectContaining({ isPro: false }));
  });

  it('Free + 90 días: bloqueado — paywall_viewed medido y bloque de upgrade visible', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();

    selectPeriod(renderer, '90D');

    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'trends' });
    expect(findUpgradeButton(renderer)).toBeDefined();
  });

  it('Pro + 7/30/90: siempre permitido, nunca bloque de upgrade ni paywall_viewed', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: true });
    const renderer = await renderScreen();

    for (const label of ['7D', '30D', '90D'] as const) {
      selectPeriod(renderer, label);
      expect(findUpgradeButton(renderer)).toBeUndefined();
    }
    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
    expect(mockProModal).not.toHaveBeenCalled();
  });

  it('navegación inicial de Free: aterriza directamente en 7 días, sin bloqueo', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();

    // El selector aterriza en 7D (no 30D, el valor por defecto histórico
    // para Pro) y el contenido está accesible desde el primer render, sin
    // necesidad de tocar el selector.
    expect(findUpgradeButton(renderer)).toBeUndefined();
    expect(mockProModal).not.toHaveBeenCalled();
  });

  it('el selector de rango sigue funcionando: Free puede volver de 30D (bloqueado) a 7D (permitido) sin salir de la pantalla', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();

    selectPeriod(renderer, '30D');
    expect(findUpgradeButton(renderer)).toBeDefined();

    selectPeriod(renderer, '7D');
    expect(findUpgradeButton(renderer)).toBeUndefined();
  });
});
