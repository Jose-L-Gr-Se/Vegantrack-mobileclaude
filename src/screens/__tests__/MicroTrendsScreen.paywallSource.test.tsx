/**
 * Auditoría de instrumentación del funnel — cubre a quien llega directamente
 * a `MicroTrendsScreen` sin Pro (p. ej. deep link), sin pasar por el botón
 * de Dashboard/Perfil (que ya no bloquean su propio punto de entrada — ver
 * `MicroTrendsScreen.freeAccess.test.tsx`). Mismo `source` porque es el
 * mismo gate real.
 *
 * Contrato tras abrir 7 días a Free (auditoría de experiencia de retorno
 * 3/7/14 días): `paywall_viewed('trends')` sólo debe medir un intento REAL
 * de acceder a contenido Pro (30/90 días), no el acceso legítimo a 7 días.
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
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

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

/** Localiza el botón del selector de periodo por su etiqueta ('7D'/'30D'/'90D')
 * y sube hasta el `Pressable` padre con `onPress`. */
function selectPeriod(renderer: TestRenderer.ReactTestRenderer, label: '7D' | '30D' | '90D') {
  let node = renderer.root.findAllByType(Text).find((n) => n.props.children === label)!;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' }, profile: { sex: 'female' } });
  (useDiaryStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ getMicroTrends: jest.fn().mockResolvedValue([]) })
  );
});

describe('MicroTrendsScreen — source de paywall_viewed', () => {
  it('Free aterriza en 7 días por defecto: NO mide paywall_viewed (ya no es un intento de acceder a Pro)', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    await renderScreen();
    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
  });

  it('Free que cambia a 30 días SÍ mide paywall_viewed(trends)', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();
    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());

    selectPeriod(renderer, '30D');

    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'trends' });
  });

  it('llegar siendo Pro no mide ningún paywall_viewed, en ningún rango', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: true });
    const renderer = await renderScreen();

    selectPeriod(renderer, '30D');
    selectPeriod(renderer, '90D');
    selectPeriod(renderer, '7D');

    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
  });
});
