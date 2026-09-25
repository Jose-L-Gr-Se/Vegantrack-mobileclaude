/**
 * Auditoría del flujo de foto-IA — reintentar un fallo transitorio del
 * servidor (IA saturada, límite de peticiones, corte global, error
 * genérico) con la MISMA foto, sin obligar a repetir cámara/galería.
 * `no_food` es la única excepción real: si la IA no vio comida, repetir con
 * la misma foto fallaría exactamente igual, así que exige una foto distinta
 * (`error.retryable === false`).
 *
 * Mismo arnés que `useMealPhoto.privacy.test.tsx` (harness con
 * `TestRenderer`, ya que `renderHook` no es fiable en este repo con React 19
 * + RNTL 14).
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { useMealPhoto } from '@/hooks/useMealPhoto';
import { analyzeMealPhoto } from '@/lib/mealVision';
import { track } from '@/lib/analytics';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/lib/mealVision', () => ({
  ...jest.requireActual('@/lib/mealVision'),
  analyzeMealPhoto: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

let latestPhoto: ReturnType<typeof useMealPhoto>;
function Harness() {
  latestPhoto = useMealPhoto();
  return (
    <Pressable onPress={() => void latestPhoto.capture('camera')}>
      <Text>capture</Text>
    </Pressable>
  );
}

function renderHarness() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness />);
  });
  return renderer;
}

function pressCapture(renderer: TestRenderer.ReactTestRenderer) {
  const [pressable] = renderer.root.findAll((n) => typeof n.props.onPress === 'function');
  return act(async () => {
    await pressable.props.onPress();
  });
}

const SUCCESS_ANALYSIS = {
  is_food: true,
  food_name: 'Lentejas',
  estimated_grams: 200,
  per_100g: { calories: 100, protein_g: 8, carbs_g: 15, fat_g: 1, fiber_g: 5, sugar_g: 1, saturated_fat_g: 0.2 },
  is_vegan: true,
  vegan_confidence: 'high' as const,
  non_vegan_ingredients: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ base64: 'ZmFrZQ==', mimeType: 'image/jpeg' }],
  });
});

describe('useMealPhoto — error.retryable distingue fallos transitorios de "no_food"', () => {
  it.each([
    ['rate_limit', true],
    ['ai_quota_exceeded', true],
    ['global_block', true],
    ['no_food', false],
  ] as const)('%s → retryable=%s', async (reason, expectedRetryable) => {
    (analyzeMealPhoto as jest.Mock).mockResolvedValue({ ok: false, reason });
    const renderer = renderHarness();
    await pressCapture(renderer);

    expect(latestPhoto.error?.retryable).toBe(expectedRetryable);
  });

  it('un error genérico sin reason mapeado también es retryable (fallo de red/parseo del lado del servidor)', async () => {
    (analyzeMealPhoto as jest.Mock).mockResolvedValue({ ok: false, reason: 'error', message: 'boom' });
    const renderer = renderHarness();
    await pressCapture(renderer);

    expect(latestPhoto.error?.retryable).toBe(true);
  });
});

describe('useMealPhoto — retry() reutiliza la última foto sin volver a abrir cámara/galería', () => {
  it('tras un fallo transitorio, retry() reanaliza la MISMA foto (mismo base64/mime) y puede tener éxito', async () => {
    (analyzeMealPhoto as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'ai_quota_exceeded' });
    const renderer = renderHarness();
    await pressCapture(renderer);
    expect(latestPhoto.error?.retryable).toBe(true);

    (analyzeMealPhoto as jest.Mock).mockResolvedValueOnce({
      ok: true,
      analysis: SUCCESS_ANALYSIS,
      remaining: 3,
      limit: 5,
      period: 'week',
    });
    await act(async () => {
      await latestPhoto.retry();
    });

    expect(analyzeMealPhoto).toHaveBeenCalledTimes(2);
    // Misma foto en las dos llamadas — nunca se volvió a pasar por el picker.
    expect((analyzeMealPhoto as jest.Mock).mock.calls[0]).toEqual((analyzeMealPhoto as jest.Mock).mock.calls[1]);
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1); // sólo la captura original
    expect(latestPhoto.food?.food_name).toBe('Lentejas');
    expect(latestPhoto.error).toBeNull();
  });

  it('retry() NO emite photo_scan_started (no se ha vuelto a elegir ninguna fuente)', async () => {
    (analyzeMealPhoto as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'rate_limit' });
    const renderer = renderHarness();
    await pressCapture(renderer);
    (track as jest.Mock).mockClear();

    (analyzeMealPhoto as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'rate_limit' });
    await act(async () => {
      await latestPhoto.retry();
    });

    expect(track).not.toHaveBeenCalledWith('photo_scan_started', expect.anything());
    // Pero el resultado del reintento sí se mide, igual que cualquier intento.
    expect(track).toHaveBeenCalledWith('photo_scan_error', expect.objectContaining({ reason: 'rate_limit' }));
  });

  it('sin ninguna foto previa, retry() no hace nada (no revienta)', async () => {
    const renderer = renderHarness();
    void renderer;
    await act(async () => {
      await latestPhoto.retry();
    });

    expect(analyzeMealPhoto).not.toHaveBeenCalled();
  });

  it('una segunda captura real (nueva foto) sigue emitiendo photo_scan_started, a diferencia de retry()', async () => {
    (analyzeMealPhoto as jest.Mock).mockResolvedValue({ ok: false, reason: 'rate_limit' });
    const renderer = renderHarness();
    await pressCapture(renderer);

    expect(track).toHaveBeenCalledWith('photo_scan_started', { source: 'camera' });
  });
});
