/**
 * Auditoría de perfil/objetivos: fecha de nacimiento y sexo se piden en el
 * onboarding (afectan al TDEE/BMR vía `calculateTargets` y a la RDA de
 * hierro vía `ironRdaForSex`), pero `EditProfileModal` no exponía ninguna
 * forma de corregirlos después. Un error al rellenarlos en el onboarding
 * (fecha equivocada, sexo equivocado) quedaba fijo para siempre — el usuario
 * no tenía ningún camino, ni siquiera "Editar perfil", para arreglarlo.
 *
 * Mismo arnés que `ProfileScreen.editProfileValidation.test.tsx` (mismo
 * componente exportado sólo para test, mismo mock mínimo de dependencias
 * ajenas a esta validación).
 */
import React from 'react';
import { Alert, TextInput } from 'react-native';
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
  disableDailyReminder: jest.fn(),
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

/** Los 3 recuadros DD/MM/AAAA del `DateField` de fecha de nacimiento —
 * localizados por placeholder, ya que no exponen una única `label` de
 * accesibilidad como `Input`. */
function dateBoxes(renderer: TestRenderer.ReactTestRenderer) {
  const inputs = renderer.root.findAll((n) => n.type === TextInput);
  return {
    day: inputs.find((n) => n.props.placeholder === 'DD')!,
    month: inputs.find((n) => n.props.placeholder === 'MM')!,
    year: inputs.find((n) => n.props.placeholder === 'AAAA')!,
  };
}

function setBirthDate(renderer: TestRenderer.ReactTestRenderer, day: string, month: string, year: string) {
  const boxes = dateBoxes(renderer);
  act(() => boxes.day.props.onChangeText(day));
  act(() => boxes.month.props.onChangeText(month));
  act(() => boxes.year.props.onChangeText(year));
}

/** Pulsa el `OptionRow` cuya etiqueta es exactamente `label` — sube desde el
 * propio nodo de texto hasta el `Pressable` más cercano, en vez de buscar
 * "un Pressable que contenga este texto en algún punto de su árbol": los dos
 * `Pressable` que envuelven TODO el modal (fondo oscuro + el que traga el
 * tap dentro) también "contienen" cualquier texto de la hoja, y al ser
 * ancestros se visitan antes que el `OptionRow` real en un recorrido en
 * profundidad — así que esa búsqueda ingenua pulsaría el fondo del modal,
 * no la opción. Mismo criterio que `SearchScreen.mealSavedToast.test.tsx`. */
function pressOptionRow(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const [textNode] = renderer.root.findAll(
    (n) => typeof n.props?.children === 'string' && n.props.children === label
  );
  let node = textNode;
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node.props.onPress());
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('EditProfileModal — fecha de nacimiento y sexo ahora se pueden corregir', () => {
  it('la fecha de nacimiento y el sexo del perfil aparecen precargados', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: jest.fn() });
    const renderer = renderModal();

    const boxes = dateBoxes(renderer);
    expect(boxes.day.props.value).toBe('20');
    expect(boxes.month.props.value).toBe('05');
    expect(boxes.year.props.value).toBe('1996');
    // "Mujer" seleccionada (BASE_PROFILE.sex === 'female') — se comprueba
    // indirectamente guardando sin tocar nada y mirando el payload, ver test
    // siguiente.
  });

  it('corregir la fecha de nacimiento cambia el payload Y recalcula los objetivos (misma altura/peso/sexo, distinta edad)', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    // Antes de tocar nada: guardar reenvía la fecha/objetivos originales.
    await pressSave(renderer);
    const originalCalorieTarget = mockUpdateProfile.mock.calls[0][0].calorie_target;
    expect(mockUpdateProfile.mock.calls[0][0].birth_date).toBe('1996-05-20');
    mockUpdateProfile.mockClear();

    // Corrige la fecha a una edad bastante mayor — el TDEE/BMR (y por tanto
    // el calorie_target) debe cambiar en consecuencia, no quedarse fijo.
    setBirthDate(renderer, '20', '05', '1950');
    await pressSave(renderer);

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    const payload = mockUpdateProfile.mock.calls[0][0];
    expect(payload.birth_date).toBe('1950-05-20');
    expect(payload.calorie_target).not.toBe(originalCalorieTarget);
  });

  it('fecha de nacimiento futura: no llama a updateProfile y avisa con un mensaje no técnico', async () => {
    const mockUpdateProfile = jest.fn();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    setBirthDate(renderer, '01', '01', '2099');
    await pressSave(renderer);

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Fecha de nacimiento no válida', expect.stringMatching(/futura/i));
  });

  it('vaciar la fecha de nacimiento la persiste como null (mismo criterio que altura/peso), sin bloquear el guardado', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    setBirthDate(renderer, '', '', '');
    await pressSave(renderer);

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile.mock.calls[0][0].birth_date).toBeNull();
    // Sin fecha de nacimiento no se puede calcular el TDEE: los objetivos no
    // se tocan (quedan como estaban), no se inventa un valor.
    expect(mockUpdateProfile.mock.calls[0][0].calorie_target).toBeUndefined();
  });

  it('cambiar el sexo actualiza el payload Y recalcula el calorie_target (mismo peso/altura/edad, la fórmula BMR difiere por sexo)', async () => {
    const mockUpdateProfile = jest.fn().mockResolvedValue({ error: null });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ profile: BASE_PROFILE, updateProfile: mockUpdateProfile });
    const renderer = renderModal();

    await pressSave(renderer); // sexo original: female
    const femaleCalorieTarget = mockUpdateProfile.mock.calls[0][0].calorie_target;
    mockUpdateProfile.mockClear();

    pressOptionRow(renderer, 'Hombre');
    await pressSave(renderer);

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    const payload = mockUpdateProfile.mock.calls[0][0];
    expect(payload.sex).toBe('male');
    expect(payload.calorie_target).not.toBe(femaleCalorieTarget);
  });
});
