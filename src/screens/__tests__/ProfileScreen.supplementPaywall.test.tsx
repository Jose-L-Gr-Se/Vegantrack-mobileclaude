/**
 * Auditoría de instrumentación del funnel — cierre del dead-end de
 * suplementos en `SupplementsModal` (Perfil): alcanzar el límite free ya no
 * deja al usuario en un `Alert` sin salida. Ahora ofrece "Ver Pro" (abre
 * `ProModal`) y mide `paywall_viewed` con `source: 'supplements_limit'`.
 *
 * `SupplementsModal` se exporta sólo para este test (mismo criterio que
 * `EditProfileModal` en `ProfileScreen.editProfileValidation.test.tsx`).
 */
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { SupplementsModal } from '@/screens/ProfileScreen';
import { useAuthStore } from '@/stores/authStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { usePro } from '@/hooks/usePro';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({
  useSupplementStore: jest.fn(),
  SUPPLEMENT_PRESETS: [],
}));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({
  usePro: jest.fn(),
  FREE_SUPPLEMENT_LIMIT: 3,
}));
jest.mock('@/lib/supabase', () => ({ WEB_BASE_URL: 'https://vegantrack.app' }));
jest.mock('@/notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 20,
  getReminderHour: jest.fn().mockResolvedValue(20),
  scheduleDailyReminder: jest.fn(),
  cancelDailyReminder: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));

const mockProModal = jest.fn((_props: unknown) => null);
jest.mock('@/components/ProModal', () => ({ ProModal: (props: unknown) => mockProModal(props) }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderModal() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <SupplementsModal onClose={jest.fn()} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function findByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  const [node] = renderer.root.findAll((n) => n.props.children === text);
  return node;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    supplements: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], // ya en el límite free (3)
    createSupplement: jest.fn(),
    updateSupplement: jest.fn(),
    deleteSupplement: jest.fn(),
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('SupplementsModal (Perfil) — cierre del dead-end de paywall', () => {
  it('alcanzar el límite free mide paywall_viewed(supplements_limit) y el Alert ofrece "Ver Pro" que abre ProModal', () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = renderModal();

    act(() => {
      let node = findByText(renderer, 'Crear suplemento personalizado');
      while (node.parent && typeof node.props.onPress !== 'function') node = node.parent;
      node.props.onPress();
    });

    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'supplements_limit' });
    expect(alertSpy).toHaveBeenCalledWith(
      'Límite alcanzado',
      expect.stringContaining('3 suplementos'),
      expect.arrayContaining([expect.objectContaining({ text: 'Ver Pro', onPress: expect.any(Function) })])
    );

    const verPro = alertSpy.mock.calls[0][2].find((b: { text: string }) => b.text === 'Ver Pro');
    expect(mockProModal).not.toHaveBeenCalled();
    act(() => verPro.onPress());
    expect(mockProModal).toHaveBeenCalledWith(expect.objectContaining({ isPro: false }));
  });

  it('con hueco libre (por debajo del límite), no dispara paywall_viewed ni Alert', () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    (useSupplementStore as unknown as jest.Mock).mockReturnValue({
      supplements: [{ id: 's1' }],
      createSupplement: jest.fn(),
      updateSupplement: jest.fn(),
      deleteSupplement: jest.fn(),
    });
    const renderer = renderModal();

    act(() => {
      let node = findByText(renderer, 'Crear suplemento personalizado');
      while (node.parent && typeof node.props.onPress !== 'function') node = node.parent;
      node.props.onPress();
    });

    expect(track).not.toHaveBeenCalledWith('paywall_viewed', expect.anything());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
