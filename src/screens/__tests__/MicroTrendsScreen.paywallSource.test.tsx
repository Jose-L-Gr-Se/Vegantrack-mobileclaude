/**
 * Auditoría de instrumentación del funnel — cubre a quien llega directamente
 * a `MicroTrendsScreen` sin Pro (p. ej. deep link), sin pasar por el botón
 * de Dashboard/Perfil (que ya miden `paywall_viewed('trends')` en su propio
 * punto). Mismo `source` porque es el mismo gate real.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { MicroTrendsScreen } from '@/screens/MicroTrendsScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { usePro } from '@/hooks/usePro';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-svg', () => ({ Line: () => null, Polyline: () => null, Circle: () => null, default: () => null }));
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

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' }, profile: { sex: 'female' } });
  (useDiaryStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ getMicroTrends: jest.fn().mockResolvedValue([]) })
  );
});

describe('MicroTrendsScreen — source de paywall_viewed', () => {
  it('llegar sin Pro mide paywall_viewed(trends)', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    await renderScreen();
    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'trends' });
  });

  it('llegar siendo Pro no mide ningún paywall_viewed', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: true });
    await renderScreen();
    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
  });
});
