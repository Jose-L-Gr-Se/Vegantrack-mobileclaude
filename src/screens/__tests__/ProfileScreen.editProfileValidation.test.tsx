/**
 * Auditoría de onboarding — cierre de los Bugs B2/B3/B4 en `EditProfileModal`
 * (edición posterior del perfil): elimina el fallback silencioso
 * `parseFloat(...) || profile?.height_cm`, usa el mismo validador y el mismo
 * criterio de coma/punto que el onboarding, y nunca muestra un error crudo
 * de Supabase.
 *
 * `EditProfileModal` se exporta sólo para este test — se testea en
 * aislamiento, sin montar el resto de ProfileScreen (suplementos, alimentos
 * propios, recordatorios, Pro...), que no participan en esta validación.
 */
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { EditProfileModal } from '@/screens/ProfileScreen';
import { useAuthStore } from '@/stores/authStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({
  useSupplementStore: jest.fn(),
  SUPPLEMENT_PRESETS: [],
}));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({
  usePro: jest.fn(() => ({ isPro: false })),
  FREE_HISTORY_DAYS: 14,
  FREE_SUPPLEMENT_LIMIT: 3,
}));
jest.mock('@/lib/supabase', () => ({ WEB_BASE_URL: 'https://vegantrack.app' }));
jest.mock('@/notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 20,
  getReminderHour: jest.fn().mockResolvedValue(20),
  scheduleDailyReminder: jest.fn(),
  cancelDailyReminder: jest.fn(),
}));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));
jest.mock('@/components/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));

const BASE_PROFILE = {
  id: 'user-1',
  display_name: 'Ana',
  height_cm: 165,
  weight_kg: 60,
  birth_date: '1996-05-20',
  sex: 'female' as const,
  activity_level: 'moderate' as const,
  goal: 'maintain' as const,
};

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderModal() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <EditProfileModal onClose={jest.fn()} />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function findInputByLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [input] = renderer.root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Input' && n.props.label === label
  );
  return input;
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

async function pressSave(renderer: TestRenderer.ReactTestRenderer) {
  await act(async () => {
    await findButtonByTitle(renderer, 'Guardar (recalcula objetivos)').props.onPress();
  });
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('EditProfileModal — validación de altura/peso (auditoría de onboarding)', () => {
  it('altura no numérica: no llama a updateProfile y avisa con un mensaje no técnico', async () => {
    const mockUpdateProfile = jest.fn();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('abc'));
    await pressSave(renderer);

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Altura no válida', expect.stringMatching(/número/i));
  });

  it('peso fuera de rango: no llama a updateProfile', async () => {
    const mockUpdateProfile = jest.fn();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('900'));
    await pressSave(renderer);

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Peso no válido', expect.any(String));
  });

  it('valor válido: actualiza con el número parseado', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText('170'));
    act(() => findInputByLabel(renderer, 'Peso (kg)').props.onChangeText('63'));
    await pressSave(renderer);

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    const payload = mockUpdateProfile.mock.calls[0][0];
    expect(payload.height_cm).toBe(170);
    expect(payload.weight_kg).toBe(63);
  });

  it('coma y punto decimal producen exactamente el mismo payload', async () => {
    const withComma = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: withComma });
    const rendererComma = renderModal();
    act(() => findInputByLabel(rendererComma, 'Altura (cm)').props.onChangeText('170,5'));
    await pressSave(rendererComma);

    const withDot = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: withDot });
    const rendererDot = renderModal();
    act(() => findInputByLabel(rendererDot, 'Altura (cm)').props.onChangeText('170.5'));
    await pressSave(rendererDot);

    expect(withComma.mock.calls[0][0].height_cm).toBe(170.5);
    expect(withDot.mock.calls[0][0].height_cm).toBe(170.5);
  });

  it('campo vaciado a propósito se persiste como null, nunca revierte en silencio al valor anterior (Bug B2)', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    act(() => findInputByLabel(renderer, 'Altura (cm)').props.onChangeText(''));
    await pressSave(renderer);

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    // Antes: `parseFloat('') || profile?.height_cm || null` mandaba 165 (el
    // valor anterior) en silencio. Ahora: vacío se respeta como "sin dato".
    expect(mockUpdateProfile.mock.calls[0][0].height_cm).toBeNull();
  });

  it('error de Supabase al guardar: nunca se muestra el mensaje técnico crudo (Bug B3)', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: 'permission denied for table profiles' });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    await pressSave(renderer);

    expect(alertSpy).toHaveBeenCalledWith('Error', expect.any(String));
    const shown = alertSpy.mock.calls.find((c) => c[0] === 'Error')?.[1];
    expect(shown).not.toMatch(/permission denied/i);
    expect(shown).toMatch(/no se pudo guardar/i);
  });
});
