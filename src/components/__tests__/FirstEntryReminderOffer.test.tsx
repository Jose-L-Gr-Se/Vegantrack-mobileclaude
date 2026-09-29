/**
 * Auditoría de activación — oferta única de activar el recordatorio tras la
 * primera comida. `diaryStore.addEntry` decide CUÁNDO corresponde mostrarla
 * (ver `diaryStore.firstEntryReminderOffer.test.ts`); este archivo prueba
 * sólo la UI: qué hace cada botón, y que reutiliza literalmente
 * `scheduleDailyReminder` (mismo criterio y mismo texto de permiso denegado
 * que ya usa el interruptor de Perfil).
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { FirstEntryReminderOffer } from '@/components/FirstEntryReminderOffer';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { DEFAULT_REMINDER_HOUR, scheduleDailyReminder } from '@/notifications/reminders';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 20,
  scheduleDailyReminder: jest.fn(),
}));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

let renderer: TestRenderer.ReactTestRenderer | null = null;

function renderOffer() {
  act(() => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <FirstEntryReminderOffer />
      </SafeAreaProvider>
    );
  });
  return renderer!;
}

function setPending(value: boolean) {
  act(() => useUiStore.setState({ reminderOfferPending: value }));
}

function findPressableWithText(r: TestRenderer.ReactTestRenderer, text: string) {
  return r.root
    .findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Pressable')
    .find((p) => p.findAllByType(Text).some((t) => t.props.children === text));
}

function findActivateButton(r: TestRenderer.ReactTestRenderer) {
  const [button] = r.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      n.props.title === 'Activar recordatorio'
  );
  return button;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' } })
  );
  setPending(false);
});

afterEach(() => {
  alertSpy.mockRestore();
  act(() => renderer?.unmount());
  renderer = null;
});

describe('FirstEntryReminderOffer', () => {
  it('no renderiza nada si no hay oferta pendiente', () => {
    const r = renderOffer();
    expect(findPressableWithText(r, 'Ahora no')).toBeUndefined();
    expect(r.root.findAllByType(Text).some((t) => t.props.children === '¡Primera comida registrada!')).toBe(
      false
    );
  });

  it('con oferta pendiente, muestra el mensaje y los dos botones', () => {
    setPending(true);
    const r = renderOffer();

    expect(r.root.findAllByType(Text).some((t) => t.props.children === '¡Primera comida registrada!')).toBe(
      true
    );
    expect(findPressableWithText(r, 'Ahora no')).toBeDefined();
    expect(findActivateButton(r)).toBeDefined();
  });

  it('"Ahora no" cierra sin llamar a scheduleDailyReminder ni dejar la oferta pendiente', () => {
    setPending(true);
    const r = renderOffer();

    act(() => findPressableWithText(r, 'Ahora no')!.props.onPress());

    expect(scheduleDailyReminder).not.toHaveBeenCalled();
    expect(useUiStore.getState().reminderOfferPending).toBe(false);
  });

  it('"Activar recordatorio" llama a scheduleDailyReminder con el usuario y la hora por defecto, y cierra la oferta', async () => {
    (scheduleDailyReminder as jest.Mock).mockResolvedValue(true);
    setPending(true);
    const r = renderOffer();

    await act(async () => {
      await findActivateButton(r).props.onPress();
    });

    expect(scheduleDailyReminder).toHaveBeenCalledWith('user-1', DEFAULT_REMINDER_HOUR);
    expect(useUiStore.getState().reminderOfferPending).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('si el sistema deniega el permiso, avisa con el mismo texto que Perfil y también cierra la oferta', async () => {
    (scheduleDailyReminder as jest.Mock).mockResolvedValue(false);
    setPending(true);
    const r = renderOffer();

    await act(async () => {
      await findActivateButton(r).props.onPress();
    });

    expect(useUiStore.getState().reminderOfferPending).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith(
      'Permiso denegado',
      'Activa las notificaciones de VegeTrack en Ajustes de Android.'
    );
  });
});
