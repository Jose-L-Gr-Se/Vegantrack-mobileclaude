/**
 * Bloque 1 de activación (Product Audit v2) — "onboarding_completed →
 * first_food_logged". `PostOnboardingWelcome` deja de ser una pantalla de
 * bienvenida con upsell de Pro y pasa a ser el paso de activación: explica
 * en un par de frases qué se obtiene al registrar la primera comida y ofrece
 * las dos vías ya existentes (IA / búsqueda), además de permitir saltar al
 * resumen. No introduce ninguna lógica de captura/añadido nueva — sólo
 * navega a las pantallas que ya la implementan, con un parámetro.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { PostOnboardingWelcome } from '@/components/PostOnboardingWelcome';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Circle: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <PostOnboardingWelcome />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

/** Los tres controles de esta pantalla no tienen otro texto igual, así que
 * se localizan por el texto exacto de su título. */
function pressByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  const textNode = renderer.root.findByProps({ children: text });
  let node = textNode;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  act(() => useUiStore.setState({ justOnboarded: false }));
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({
      profile: {
        display_name: 'Ana',
        calorie_target: 1900,
        protein_target_g: 95,
        carbs_target_g: 230,
        fat_target_g: 65,
      },
    })
  );
});

describe('PostOnboardingWelcome — activación tras el onboarding', () => {
  it('no renderiza nada si justOnboarded es false', () => {
    const renderer = render();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Todo listo');
  });

  it('con justOnboarded, explica el valor de registrar la primera comida y ofrece las dos vías + saltar', () => {
    act(() => useUiStore.setState({ justOnboarded: true }));
    const renderer = render();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Registra tu primera comida');
    expect(text).toContain('Analizar con IA');
    expect(text).toContain('Buscar alimento');
    expect(text).toContain('Ahora no, ir al resumen');
    // Ya no es una pantalla de marketing/upsell de Pro en este paso.
    expect(text).not.toContain('Desbloquea todo con Pro');
    expect(text).not.toContain('Ver planes Pro');
  });

  it('"Analizar con IA" navega al Diario con startAction=photo y cierra la pantalla', () => {
    act(() => useUiStore.setState({ justOnboarded: true }));
    const renderer = render();
    pressByText(renderer, '📷 Analizar con IA');
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'Diary',
      params: { startAction: 'photo' },
    });
    expect(useUiStore.getState().justOnboarded).toBe(false);
  });

  it('"Buscar alimento" navega a Search con fromActivation=true y cierra la pantalla', () => {
    act(() => useUiStore.setState({ justOnboarded: true }));
    const renderer = render();
    pressByText(renderer, '🔍 Buscar alimento');
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'Search',
      params: { fromActivation: true },
    });
    expect(useUiStore.getState().justOnboarded).toBe(false);
  });

  it('saltar navega directamente al Dashboard y cierra la pantalla, sin romper el flujo', () => {
    act(() => useUiStore.setState({ justOnboarded: true }));
    const renderer = render();
    pressByText(renderer, 'Ahora no, ir al resumen');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Dashboard' });
    expect(useUiStore.getState().justOnboarded).toBe(false);
  });
});
