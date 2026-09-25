/**
 * Limpieza de claims de Pro (auditoría de propuesta de valor Free → Pro).
 *
 * La auditoría encontró tres beneficios en `PLANS` sin respaldo real:
 *   - "Exportar el diario a CSV": Free ya puede exportar (recortado a
 *     `FREE_HISTORY_DAYS`), no es exclusivo de Pro.
 *   - "Soporte prioritario": no existe ningún mecanismo de soporte
 *     diferenciado en el producto.
 *   - "Acceso anticipado a novedades": no existe ninguna infraestructura de
 *     beta/feature flags que lo implemente.
 * Y un claim impreciso: "IA sin límite" cuando el servidor aplica un tope
 * real de 100 análisis/día (`PRO_DAILY_SCANS`, `analyze-meal`).
 *
 * Este test fija el contrato de copy para que ninguno de los tres beneficios
 * retirados reaparezca por accidente y para que el límite de IA se describa
 * siempre de forma técnicamente exacta. No cubre pricing, RevenueCat ni el
 * flujo de compra (ver `ProModal.tracking.test.tsx`).
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ProModal } from '@/components/ProModal';
import { useAuthStore } from '@/stores/authStore';
import { usePurchasesStore } from '@/stores/purchasesStore';

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

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ fetchProfile: jest.fn() })
  );
  (usePurchasesStore as unknown as jest.Mock).mockReturnValue({
    offerings: null,
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

/** Todo el texto visible del modal, plano, para buscar substrings sin
 * depender de en qué nodo de Text cae cada frase. */
function allText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .flat()
    .filter((c) => typeof c === 'string')
    .join(' | ');
}

describe('ProModal — catálogo de beneficios Pro (limpieza de claims)', () => {
  it('no muestra "Exportar el diario a CSV" como beneficio Pro (Free ya puede exportar)', () => {
    const text = allText(renderProModal());
    expect(text).not.toMatch(/exportar.*csv/i);
  });

  it('no muestra "Soporte prioritario" (no existe ningún mecanismo de soporte diferenciado)', () => {
    const text = allText(renderProModal());
    expect(text).not.toMatch(/soporte prioritario/i);
  });

  it('no muestra "Acceso anticipado a novedades" (no existe infraestructura de beta/feature flags)', () => {
    const text = allText(renderProModal());
    expect(text).not.toMatch(/acceso anticipado/i);
  });

  it('describe el límite de IA como 100/día, nunca como "sin límite"', () => {
    const text = allText(renderProModal());
    expect(text).not.toMatch(/ia sin l[íi]mite/i);
    expect(text).toMatch(/100 an[aá]lisis/i);
  });
});
