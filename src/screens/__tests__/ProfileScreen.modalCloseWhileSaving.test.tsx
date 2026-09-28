/**
 * Auditoría de navegación/modales — `EditProfileModal` y `CustomFoodModal`
 * podían cerrarse (tap fuera, botón atrás del sistema, deslizar el sheet, o
 * el propio "Cancelar") MIENTRAS un guardado seguía en vuelo. Ninguna de esas
 * vías de cierre comprobaba el estado `saving` — sólo el botón "Guardar" se
 * deshabilitaba con `loading={saving}`. El guardado en curso no se cancelaba
 * al cerrar: la actualización se aplicaba igual en segundo plano tras
 * desaparecer la UI, contradiciendo la intención de "cancelar" del usuario
 * (que veía el modal desaparecer sin ninguna confirmación de qué pasó con su
 * guardado pendiente).
 *
 * `EditProfileModal`/`CustomFoodModal` se exportan sólo para tests (mismo
 * criterio que `ProfileScreen.editProfileValidation.test.tsx`/
 * `ProfileScreen.customFoodVegan.test.tsx`).
 */
import React from 'react';
import { Modal } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { EditProfileModal, CustomFoodModal } from '@/screens/ProfileScreen';
import { useAuthStore } from '@/stores/authStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({ useSupplementStore: jest.fn(), SUPPLEMENT_PRESETS: [] }));
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
  disableDailyReminder: jest.fn(),
}));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));

// `BottomSheet` se sustituye por un contenedor mínimo que sigue renderizando
// `children`/`footer` (para poder encontrar los botones de dentro) — a
// diferencia de mockearlo como `() => null`, esto permite localizar la
// instancia mockeada por tipo y leer/invocar su prop `onClose` directamente,
// simulando cualquiera de los 4 gestos de cierre reales sin reimplementarlos.
jest.mock('@/components/BottomSheet', () => ({
  BottomSheet: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
import { BottomSheet } from '@/components/BottomSheet';

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

/** Pulsa el `Pressable` de texto plano cuya etiqueta es exactamente `label`
 *  (p. ej. "Crear alimento personalizado") — mismo helper que
 *  `ProfileScreen.customFoodVegan.test.tsx`. */
function pressByText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [textNode] = renderer.root.findAll(
    (n) => typeof n.props?.children === 'string' && n.props.children === label
  );
  let node = textNode;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EditProfileModal — cerrar (tap fuera / atrás / Cancelar) mientras se guarda no debe descartar la UI en silencio', () => {
  function renderModal(onClose: () => void) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
          <EditProfileModal onClose={onClose} />
        </SafeAreaProvider>
      );
    });
    return renderer;
  }

  it('el botón atrás del sistema (onRequestClose) no cierra mientras updateProfile() está en vuelo', async () => {
    let resolveUpdate!: (v: { error: null }) => void;
    const updateProfile = jest.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile });
    const onClose = jest.fn();
    const renderer = renderModal(onClose);

    act(() => { findButtonByTitle(renderer, 'Guardar (recalcula objetivos)').props.onPress(); });

    const [modal] = renderer.root.findAllByType(Modal);
    act(() => modal.props.onRequestClose());
    expect(onClose).not.toHaveBeenCalled();

    // Al terminar con éxito, `save()` ya cierra por sí solo — el intento de
    // cierre bloqueado arriba no debe sumarse a esa única llamada real.
    await act(async () => {
      resolveUpdate({ error: null });
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Cancelar" no cierra mientras se guarda, pero sí una vez terminado', async () => {
    let resolveUpdate!: (v: { error: null }) => void;
    const updateProfile = jest.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile });
    const onClose = jest.fn();
    const renderer = renderModal(onClose);

    act(() => { findButtonByTitle(renderer, 'Guardar (recalcula objetivos)').props.onPress(); });
    act(() => { findButtonByTitle(renderer, 'Cancelar').props.onPress(); });
    expect(onClose).not.toHaveBeenCalled();

    // El guardado en curso, no cancelado por el "Cancelar" bloqueado, sigue
    // su curso y cierra por sí solo al terminar con éxito.
    await act(async () => {
      resolveUpdate({ error: null });
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('comportamiento normal (sin guardado en curso): "Cancelar" cierra de inmediato', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: jest.fn() });
    const onClose = jest.fn();
    const renderer = renderModal(onClose);

    act(() => { findButtonByTitle(renderer, 'Cancelar').props.onPress(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CustomFoodModal — cerrar el sheet mientras se guarda un alimento no debe descartar la UI en silencio', () => {
  function renderModal(onClose: () => void) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
          <CustomFoodModal onClose={onClose} />
        </SafeAreaProvider>
      );
    });
    return renderer;
  }

  it('el cierre "ambiente" del sheet (tap fuera/deslizar/atrás) no cierra mientras createCustomFood() está en vuelo', async () => {
    let resolveCreate!: (v: { error: null }) => void;
    const createCustomFood = jest.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' } });
    (useCustomFoodStore as unknown as jest.Mock).mockReturnValue({
      customFoods: [],
      createCustomFood,
      updateCustomFood: jest.fn(),
      deleteCustomFood: jest.fn(),
    });
    const onClose = jest.fn();
    const renderer = renderModal(onClose);

    // Sin alimentos todavía, el CTA de la lista vacía abre el formulario de
    // creación (mismo helper y mismo texto que
    // `ProfileScreen.customFoodVegan.test.tsx`).
    pressByText(renderer, 'Crear alimento personalizado');

    const [nameInput] = renderer.root.findAll(
      (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Input' && n.props.label === 'Nombre'
    );
    act(() => nameInput.props.onChangeText('Tofu casero'));
    act(() => { findButtonByTitle(renderer, 'Crear alimento').props.onPress(); });

    const [sheet] = renderer.root.findAllByType(BottomSheet);
    act(() => sheet.props.onClose());
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate({ error: null });
      await Promise.resolve();
    });

    act(() => sheet.props.onClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
