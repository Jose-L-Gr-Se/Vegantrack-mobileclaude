/**
 * Instrumentación del funnel de monetización — auditoría de analytics.
 *
 * Cubre lo que `analytics_events` en producción confirmó que nunca se había
 * medido: `checkout_opened` (0 filas históricas), `trial_started`,
 * `purchase_completed`, `purchase_cancelled`, `purchase_failed` y
 * `purchase_restored`. Todos con `plan: 'monthly'|'annual'`, nunca datos de
 * pago ni email — ver `src/lib/analytics.ts`.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Purchases, { PACKAGE_TYPE, PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { ProModal } from '@/components/ProModal';
import { useAuthStore } from '@/stores/authStore';
import { usePurchasesStore } from '@/stores/purchasesStore';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/purchasesStore', () => ({
  usePurchasesStore: jest.fn(),
  ENTITLEMENT_PRO: 'pro',
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: { purchasePackage: jest.fn(), restorePurchases: jest.fn() },
  PACKAGE_TYPE: { MONTHLY: 'MONTHLY', ANNUAL: 'ANNUAL' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
}));

const monthlyPkg = { packageType: 'MONTHLY', product: { priceString: '4,99 €' } };
const annualPkg = { packageType: 'ANNUAL', product: { priceString: '47,99 €' } };
const mockFetchProfile = jest.fn();

function entitlementInfo(periodType: 'NORMAL' | 'TRIAL', productIdentifier = 'vegantrack_pro:monthly') {
  return { productIdentifier, periodType };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchProfile.mockResolvedValue(undefined);
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ fetchProfile: mockFetchProfile })
  );
  (usePurchasesStore as unknown as jest.Mock).mockReturnValue({
    offerings: { current: { availablePackages: [monthlyPkg, annualPkg] } },
    offeringsLoading: false,
    loadOfferings: jest.fn(),
    customerInfo: null,
  });
});

function renderProModal() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ProModal isPro={false} onClose={() => {}} />);
  });
  return renderer;
}

function findButtonByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  const [button] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      typeof n.props.onPress === 'function' &&
      n.props.title === title
  );
  return button;
}

describe('ProModal — instrumentación del funnel de compra', () => {
  it('pulsar "Elegir Pro" (mensual) dispara checkout_opened con plan monthly', async () => {
    (Purchases.purchasePackage as jest.Mock).mockReturnValue(new Promise(() => {})); // nunca resuelve en este test
    const renderer = renderProModal();
    await act(async () => {
      findButtonByTitle(renderer, 'Elegir Pro').props.onPress();
    });
    expect(track).toHaveBeenCalledWith('checkout_opened', { plan: 'monthly' });
  });

  it('pulsar "Elegir Pro anual" dispara checkout_opened con plan annual', async () => {
    (Purchases.purchasePackage as jest.Mock).mockReturnValue(new Promise(() => {}));
    const renderer = renderProModal();
    await act(async () => {
      findButtonByTitle(renderer, 'Elegir Pro anual').props.onPress();
    });
    expect(track).toHaveBeenCalledWith('checkout_opened', { plan: 'annual' });
  });

  it('compra inmediata (periodType NORMAL) dispara purchase_completed, no trial_started', async () => {
    (Purchases.purchasePackage as jest.Mock).mockResolvedValue({
      customerInfo: { entitlements: { active: { pro: entitlementInfo('NORMAL') } } },
    });
    const renderer = renderProModal();
    await act(async () => {
      await findButtonByTitle(renderer, 'Elegir Pro').props.onPress();
    });
    expect(track).toHaveBeenCalledWith('purchase_completed', { plan: 'monthly' });
    expect(track).not.toHaveBeenCalledWith('trial_started', expect.anything());
  });

  it('compra con prueba gratuita (periodType TRIAL) dispara trial_started, no purchase_completed', async () => {
    (Purchases.purchasePackage as jest.Mock).mockResolvedValue({
      customerInfo: { entitlements: { active: { pro: entitlementInfo('TRIAL', 'vegantrack_pro:annual') } } },
    });
    const renderer = renderProModal();
    await act(async () => {
      await findButtonByTitle(renderer, 'Elegir Pro anual').props.onPress();
    });
    expect(track).toHaveBeenCalledWith('trial_started', { plan: 'annual' });
    expect(track).not.toHaveBeenCalledWith('purchase_completed', expect.anything());
  });

  it('cancelar el diálogo nativo de Play dispara purchase_cancelled, no purchase_failed', async () => {
    (Purchases.purchasePackage as jest.Mock).mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
    });
    const renderer = renderProModal();
    await act(async () => {
      await findButtonByTitle(renderer, 'Elegir Pro').props.onPress();
    });
    expect(track).toHaveBeenCalledWith('purchase_cancelled', { plan: 'monthly' });
    expect(track).not.toHaveBeenCalledWith('purchase_failed', expect.anything());
  });

  it('un error real de compra dispara purchase_failed con el código de RevenueCat, nunca el mensaje libre', async () => {
    (Purchases.purchasePackage as jest.Mock).mockRejectedValue({
      code: 'NETWORK_ERROR',
      message: 'algo con detalle interno que no debe viajar tal cual',
    });
    const renderer = renderProModal();
    await act(async () => {
      await findButtonByTitle(renderer, 'Elegir Pro anual').props.onPress();
    });
    expect(track).toHaveBeenCalledWith('purchase_failed', { plan: 'annual', code: 'NETWORK_ERROR' });
    const call = (track as jest.Mock).mock.calls.find(([event]) => event === 'purchase_failed');
    expect(JSON.stringify(call)).not.toContain('detalle interno');
  });

  function findRestoreButton(renderer: TestRenderer.ReactTestRenderer) {
    let node = renderer.root.findByProps({ children: 'Restaurar compras anteriores' });
    while (node.parent && typeof node.props.onPress !== 'function') {
      node = node.parent;
    }
    return node; // el TouchableOpacity que envuelve el texto
  }

  it('restaurar compras con entitlement activo dispara purchase_restored', async () => {
    (Purchases.restorePurchases as jest.Mock).mockResolvedValue({
      entitlements: { active: { pro: entitlementInfo('NORMAL') } },
    });
    const renderer = renderProModal();
    await act(async () => {
      await findRestoreButton(renderer).props.onPress();
    });
    expect(track).toHaveBeenCalledWith('purchase_restored');
  });

  it('restaurar compras SIN entitlement activo no dispara purchase_restored', async () => {
    (Purchases.restorePurchases as jest.Mock).mockResolvedValue({
      entitlements: { active: {} },
    });
    const renderer = renderProModal();
    await act(async () => {
      await findRestoreButton(renderer).props.onPress();
    });
    expect(track).not.toHaveBeenCalledWith('purchase_restored');
  });
});
