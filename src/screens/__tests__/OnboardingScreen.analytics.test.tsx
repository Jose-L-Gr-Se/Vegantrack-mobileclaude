/**
 * Auditoría de instrumentación del funnel — `onboarding_completed` es el
 * primer paso del embudo mínimo y hoy no se medía en absoluto. Mismo harness
 * y flujo que `OnboardingScreen.validation.test.tsx` (paso 1 → 2 → 3 →
 * "Empezar ✓"), sólo que aquí se comprueba `track`.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { useAuthStore } from '@/stores/authStore';
import { track } from '@/lib/analytics';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/uiStore', () => ({
  useUiStore: { getState: () => ({ setJustOnboarded: jest.fn() }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: null }) } },
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderOnboarding() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <OnboardingScreen />
      </SafeAreaProvider>
    );
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

function findInputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [input] = renderer.root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Input' && n.props.label === label
  );
  return input;
}

function findDateField(renderer: TestRenderer.ReactTestRenderer) {
  const [field] = renderer.root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'DateField'
  );
  return field;
}

function findOptionRowByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [row] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' && (n.type as { name?: string }).name === 'OptionRow' && n.props.label === label
  );
  return row;
}

function fillStep1Valid(renderer: TestRenderer.ReactTestRenderer) {
  act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('175'));
  act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('70'));
  act(() => findDateField(renderer).props.onChange('1996-05-20'));
  act(() => findOptionRowByLabel(renderer, 'Hombre').props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OnboardingScreen — instrumentación de onboarding_completed', () => {
  it('completar el onboarding con éxito dispara onboarding_completed', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: mockUpdateProfile });
    const renderer = renderOnboarding();

    fillStep1Valid(renderer);
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress());
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress());

    await act(async () => {
      await findButtonByTitle(renderer, 'Empezar ✓').props.onPress();
    });

    expect(track).toHaveBeenCalledWith('onboarding_completed');
  });

  it('si updateProfile falla, NO se dispara onboarding_completed', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: 'permission denied' });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: mockUpdateProfile });
    const renderer = renderOnboarding();

    fillStep1Valid(renderer);
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress());
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress());

    await act(async () => {
      await findButtonByTitle(renderer, 'Empezar ✓').props.onPress();
    });

    expect(track).not.toHaveBeenCalledWith('onboarding_completed');
  });
});
