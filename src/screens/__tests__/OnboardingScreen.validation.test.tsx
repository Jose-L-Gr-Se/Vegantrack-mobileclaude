/**
 * Auditoría de onboarding — cierre de los Bugs B1/B3/B5: `step1Valid` exige
 * altura/peso/fecha de nacimiento plausibles (no sólo no vacíos), y un valor
 * inválido nunca debe llegar a `updateProfile`, ni siquiera si algún futuro
 * cambio de navegación permitiera saltarse el gate del botón "Siguiente".
 *
 * Mismo harness que DiaryScreen.flushPending.test.tsx: componente real vía
 * react-test-renderer + act().
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { supabase } from '@/lib/supabase';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));

const mockSetJustOnboarded = jest.fn();
jest.mock('@/stores/uiStore', () => ({
  useUiStore: { getState: () => ({ setJustOnboarded: mockSetJustOnboarded }) },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: null }) } },
}));

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

/** Rellena el paso 1 con datos plausibles: altura 175, peso 70, 30 años, hombre. */
function fillStep1Valid(renderer: TestRenderer.ReactTestRenderer) {
  act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('175'));
  act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('70'));
  act(() => findDateField(renderer).props.onChange('1996-05-20'));
  act(() => findOptionRowByLabel(renderer, 'Hombre').props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OnboardingScreen — validación de plausibilidad del paso 1 (auditoría de onboarding)', () => {
  it('altura no numérica: "Siguiente" queda deshabilitado y muestra un mensaje no técnico', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: jest.fn() });
    const renderer = renderOnboarding();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('abc'));
    act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('70'));
    act(() => findDateField(renderer).props.onChange('1996-05-20'));
    act(() => findOptionRowByLabel(renderer, 'Hombre').props.onPress());

    expect(findButtonByTitle(renderer, 'Siguiente →').props.disabled).toBe(true);
    const texts = renderer.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts.some((c) => typeof c === 'string' && /introduce solo números/i.test(c))).toBe(true);
  });

  it('peso fuera de rango (por debajo del mínimo plausible): "Siguiente" deshabilitado', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: jest.fn() });
    const renderer = renderOnboarding();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('175'));
    act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('5')); // por debajo de 30 kg
    act(() => findDateField(renderer).props.onChange('1996-05-20'));
    act(() => findOptionRowByLabel(renderer, 'Hombre').props.onPress());

    expect(findButtonByTitle(renderer, 'Siguiente →').props.disabled).toBe(true);
  });

  it('fecha de nacimiento futura: "Siguiente" deshabilitado', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: jest.fn() });
    const renderer = renderOnboarding();
    const future = (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().split('T')[0];
    })();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('175'));
    act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('70'));
    act(() => findDateField(renderer).props.onChange(future));
    act(() => findOptionRowByLabel(renderer, 'Hombre').props.onPress());

    expect(findButtonByTitle(renderer, 'Siguiente →').props.disabled).toBe(true);
  });

  it('datos plausibles: "Siguiente" se habilita y avanza de paso', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: jest.fn() });
    const renderer = renderOnboarding();

    fillStep1Valid(renderer);
    expect(findButtonByTitle(renderer, 'Siguiente →').props.disabled).toBe(false);

    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress());

    expect(renderer.root.findAllByType(Text).some((n) => n.props.children === 'Tu ritmo de vida')).toBe(
      true
    );
  });

  it('flujo completo válido: persiste con los valores calculados y activa la bienvenida', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: mockUpdateProfile });
    const renderer = renderOnboarding();

    fillStep1Valid(renderer);
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress()); // -> paso 2
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress()); // -> paso 3

    await act(async () => {
      await findButtonByTitle(renderer, 'Empezar ✓').props.onPress();
    });

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    const payload = mockUpdateProfile.mock.calls[0][0];
    expect(payload.height_cm).toBe(175);
    expect(payload.weight_kg).toBe(70);
    expect(payload.birth_date).toBe('1996-05-20');
    expect(payload.sex).toBe('male');
    expect(typeof payload.calorie_target).toBe('number');
    expect(mockSetJustOnboarded).toHaveBeenCalledWith(true);
    expect(supabase.functions.invoke).toHaveBeenCalled();
  });

  it('un valor inválido en el paso 1 nunca llega a updateProfile, aunque se fuerce la navegación', async () => {
    // Defensa adicional de finish(): hoy la navegación normal no permite
    // llegar aquí (el botón "Siguiente" del paso 1 está deshabilitado), pero
    // esta prueba invoca los onPress directamente —saltándose el `disabled`
    // de Pressable, que sólo actúa a través de gestos reales— para simular
    // qué pasaría si un futuro cambio de navegación abriera esa puerta.
    const mockUpdateProfile = jest.fn();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: null, updateProfile: mockUpdateProfile });
    const renderer = renderOnboarding();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('abc')); // inválido
    act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('70'));
    act(() => findDateField(renderer).props.onChange('1996-05-20'));
    act(() => findOptionRowByLabel(renderer, 'Hombre').props.onPress());
    expect(findButtonByTitle(renderer, 'Siguiente →').props.disabled).toBe(true);

    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress()); // bypass -> paso 2
    act(() => findButtonByTitle(renderer, 'Siguiente →').props.onPress()); // -> paso 3

    await act(async () => {
      await findButtonByTitle(renderer, 'Empezar ✓').props.onPress();
    });

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(
      renderer.root
        .findAllByType(Text)
        .some((n) => typeof n.props.children === 'string' && /revisa los datos/i.test(n.props.children))
    ).toBe(true);
  });
});
