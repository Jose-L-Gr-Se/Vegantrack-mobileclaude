/**
 * Auditoría de privacidad del funnel: `photo_scan_success` enviaba
 * `food_name` (contenido de comida en texto libre) a `analytics_events` —
 * confirmado en producción antes de este fix. Este test es la regresión:
 * si alguien vuelve a añadir `food_name` al payload, debe fallar.
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

function Harness() {
  const photo = useMealPhoto();
  return (
    <Pressable onPress={() => void photo.capture('camera')}>
      <Text>capture</Text>
    </Pressable>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ base64: 'ZmFrZQ==', mimeType: 'image/jpeg' }],
  });
});

it('photo_scan_success nunca incluye food_name ni ningún otro texto libre de la comida', async () => {
  (analyzeMealPhoto as jest.Mock).mockResolvedValue({
    ok: true,
    analysis: {
      is_food: true,
      food_name: 'Curry de garbanzos con leche de coco', // contenido real que NO debe viajar
      estimated_grams: 250,
      per_100g: { calories: 120, protein_g: 4, carbs_g: 10, fat_g: 6, fiber_g: 2, sugar_g: 1, saturated_fat_g: 3 },
      is_vegan: true,
      vegan_confidence: 'high',
      non_vegan_ingredients: [],
    },
    remaining: 4,
    limit: 5,
    period: 'week',
  });

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness />);
  });
  await act(async () => {
    const [pressable] = renderer.root.findAll((n) => typeof n.props.onPress === 'function');
    pressable.props.onPress();
  });

  expect(track).toHaveBeenCalledWith(
    'photo_scan_success',
    expect.not.objectContaining({ food_name: expect.anything() })
  );
  const [, props] = (track as jest.Mock).mock.calls.find(([event]) => event === 'photo_scan_success')!;
  expect(Object.keys(props)).toEqual(['is_vegan', 'remaining']);
});
