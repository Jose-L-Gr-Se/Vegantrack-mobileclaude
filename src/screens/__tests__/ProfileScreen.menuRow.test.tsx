/**
 * Auditoría de CSV/exportación — feedback visible y accesibilidad del botón
 * "Exportar diario CSV" (P1/P2). `MenuRow` es el componente compartido que
 * usa ese botón; se testea aislado (exportado sólo para tests, mismo
 * criterio que `EditProfileModal`/`SupplementsModal`).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MenuRow } from '@/screens/ProfileScreen';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// `MenuRow` no usa nada de esto — se mockea sólo para poder importarlo desde
// `ProfileScreen.tsx` sin arrastrar sus dependencias pesadas (mismo criterio
// que `ProfileScreen.editProfileValidation.test.tsx`).
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

function render(props: Partial<React.ComponentProps<typeof MenuRow>> = {}) {
  const onPress = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <MenuRow iconName="document-text-outline" label="Exportar diario CSV" onPress={onPress} {...props} />
    );
  });
  return { renderer, onPress };
}

/** El `Pressable` real, no el propio `<MenuRow>` (que también "tiene"
 * `onPress` como prop recibido) — se distingue por `accessibilityRole`,
 * que sólo pone el `Pressable` interno. */
function findPressable(renderer: TestRenderer.ReactTestRenderer) {
  const [node] = renderer.root.findAll(
    (n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole !== undefined
  );
  return node;
}

describe('MenuRow — feedback visible y accesibilidad (auditoría de CSV, P1/P2)', () => {
  it('con loading=true, el Pressable recibe disabled=true (RN corta el onPress a nivel nativo)', () => {
    // `react-test-renderer` no simula el bloqueo real de un `Pressable`
    // deshabilitado (eso lo hace el sistema de eventos nativo, fuera de lo
    // que este harness puede observar) — lo que sí se puede comprobar, y es
    // lo que produce ese bloqueo en el dispositivo real, es que el prop
    // `disabled` llega correctamente a `true`.
    const { renderer } = render({ loading: true });
    expect(findPressable(renderer).props.disabled).toBe(true);
  });

  it('sin loading ni disabled, la pulsación sí llega a onPress', () => {
    const { renderer, onPress } = render();
    expect(findPressable(renderer).props.disabled).toBeFalsy();
    act(() => findPressable(renderer).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('expone accessibilityRole, accessibilityLabel y accessibilityState correctos', () => {
    const { renderer } = render({
      loading: true,
      accessibilityLabel: 'Exportar diario a CSV',
      accessibilityHint: 'Genera un archivo CSV de tu diario y abre el menú para compartirlo',
    });
    const node = findPressable(renderer);
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityLabel).toBe('Exportar diario a CSV');
    expect(node.props.accessibilityHint).toContain('Genera un archivo CSV');
    expect(node.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('sin accessibilityLabel explícito, usa el propio label como fallback', () => {
    const { renderer } = render();
    expect(findPressable(renderer).props.accessibilityLabel).toBe('Exportar diario CSV');
  });

  it('con loading=true se muestra un indicador de actividad en vez del chevron', () => {
    const { renderer } = render({ loading: true });
    expect(renderer.root.findAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
  });

  it('sin loading, no hay indicador de actividad', () => {
    const { renderer } = render();
    expect(renderer.root.findAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
  });
});
