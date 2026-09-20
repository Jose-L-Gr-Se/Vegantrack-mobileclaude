/**
 * Copy del acceso a "Tendencias de micros" en Perfil (auditoría de
 * experiencia de retorno 3/7/14 días, ronda de corrección de copy): ahora
 * que Free puede ver 7 días, el subtítulo ya no debe sugerir que toda la
 * función es Pro — debe comunicar los dos niveles: 7 días gratis, 30/90 con
 * Pro. No toca lógica de navegación/paywall/analytics, sólo el texto.
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { useAuthStore } from '@/stores/authStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import { useThemeStore } from '@/stores/themeStore';
import { usePro } from '@/hooks/usePro';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), setParams: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/supplementStore', () => ({
  useSupplementStore: jest.fn(),
  SUPPLEMENT_PRESETS: [],
}));
jest.mock('@/stores/customFoodStore', () => ({ useCustomFoodStore: jest.fn() }));
jest.mock('@/stores/themeStore', () => ({ useThemeStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({
  usePro: jest.fn(),
  FREE_SUPPLEMENT_LIMIT: 3,
}));
jest.mock('@/lib/supabase', () => ({ WEB_BASE_URL: 'https://vegantrack.app' }));
jest.mock('@/notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 20,
  getReminderHour: jest.fn().mockResolvedValue(20),
  scheduleDailyReminder: jest.fn(),
  disableDailyReminder: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));
jest.mock('@/components/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('@/components/SupplementEditor', () => ({ SupplementEditor: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** `ProfileScreen` dispara varias promesas en su primer efecto
 * (`getReminderHour`, `fetchSupplements`, `fetchCustomFoods`) — hay que
 * esperarlas dentro de `act` o Jest puede volcar warnings de estado
 * actualizado fuera de `act` (mismo criterio que `DashboardScreen.
 * microRecommendations.test.tsx`). */
async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <ProfileScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    user: { id: 'user-1' },
    profile: { display_name: 'Ana', streak_count: 0 },
    updateProfile: jest.fn(),
    signOut: jest.fn(),
    deleteAccount: jest.fn(),
  });
  (useSupplementStore as unknown as jest.Mock).mockReturnValue({
    supplements: [],
    fetchSupplements: jest.fn().mockResolvedValue(undefined),
  });
  (useCustomFoodStore as unknown as jest.Mock).mockReturnValue({
    customFoods: [],
    fetchCustomFoods: jest.fn().mockResolvedValue(undefined),
  });
  (useThemeStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ preference: 'system', setPreference: jest.fn() })
  );
});

describe('ProfileScreen — copy del acceso a Tendencias de micros', () => {
  it('Free: el subtítulo comunica 7 días gratis y que Pro desbloquea 30/90, no que toda la función sea Pro', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });
    const renderer = await renderScreen();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('7 días gratis · Pro desbloquea 30 y 90 días');
    // No debe quedar un badge/subtítulo suelto de sólo "Pro" (regresión del
    // copy anterior, que sugería que el acceso entero requería Pro).
    expect(renderer.root.findAllByType(Text).some((n) => n.props.children === 'Pro')).toBe(false);
  });

  it('Pro: sin subtítulo de gating en la fila de Tendencias de micros', async () => {
    (usePro as unknown as jest.Mock).mockReturnValue({ isPro: true });
    const renderer = await renderScreen();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).not.toContain('7 días gratis · Pro desbloquea 30 y 90 días');
  });
});
