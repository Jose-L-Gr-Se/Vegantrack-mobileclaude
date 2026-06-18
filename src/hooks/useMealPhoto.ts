/**
 * useMealPhoto — orquesta el flujo de "VeganLens":
 *   1. pide permiso y abre cámara o galería,
 *   2. comprime la foto y la manda a analizar,
 *   3. expone el resultado como `FoodPer100g` listo para la ficha de producto,
 *   4. señala si la cuota gratuita se agotó (para abrir el paywall).
 */
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { analyzeMealPhoto, analysisToFood, type MealAnalysis } from '@/lib/mealVision';
import { track } from '@/lib/analytics';
import type { FoodPer100g, VeganConfidence } from '@/types';

interface MealPhotoState {
  analyzing: boolean;
  food: FoodPer100g | null;
  analysis: MealAnalysis | null;
  grams: number;
  confidence: VeganConfidence | undefined;
  remaining: number | null;
  limit: number;
  quotaBlocked: boolean;
}

const INITIAL: MealPhotoState = {
  analyzing: false,
  food: null,
  analysis: null,
  grams: 100,
  confidence: undefined,
  remaining: null,
  limit: 1,
  quotaBlocked: false,
};

export function useMealPhoto() {
  const [state, setState] = useState<MealPhotoState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);
  const clearQuota = useCallback(() => setState((s) => ({ ...s, quotaBlocked: false })), []);

  const capture = useCallback(async (source: 'camera' | 'library') => {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permiso necesario',
        source === 'camera'
          ? 'Activa el permiso de cámara para fotografiar tu plato.'
          : 'Activa el permiso de fotos para elegir una imagen.'
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      base64: true,
      quality: 0.4,
      allowsEditing: true,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];

    track('photo_scan_started', { source });
    setState((s) => ({ ...s, analyzing: true }));

    const res = await analyzeMealPhoto(asset.base64!, asset.mimeType ?? 'image/jpeg');

    if (res.ok) {
      track('photo_scan_success', {
        food_name: res.analysis.food_name,
        is_vegan: res.analysis.is_vegan,
        remaining: res.remaining,
      });
      setState({
        analyzing: false,
        food: analysisToFood(res.analysis),
        analysis: res.analysis,
        grams: Math.max(1, Math.round(res.analysis.estimated_grams || 100)),
        confidence: res.analysis.vegan_confidence,
        remaining: res.remaining,
        limit: res.limit,
        quotaBlocked: false,
      });
      return;
    }

    if (res.reason === 'quota') {
      track('photo_scan_quota_blocked', { limit: res.limit });
      setState((s) => ({ ...s, analyzing: false, quotaBlocked: true, remaining: 0, limit: res.limit }));
      return;
    }

    if (res.reason === 'rate_limit') {
      setState((s) => ({ ...s, analyzing: false }));
      Alert.alert(
        'Demasiado rápido',
        'Has hecho varios análisis muy seguidos. Espera un minuto y vuelve a intentarlo.'
      );
      return;
    }

    if (res.reason === 'global_block') {
      setState((s) => ({ ...s, analyzing: false }));
      Alert.alert(
        'Análisis no disponible',
        'El análisis con IA está temporalmente saturado. Prueba mañana o añade el alimento manualmente.'
      );
      return;
    }

    if (res.reason === 'no_food') {
      setState((s) => ({ ...s, analyzing: false }));
      Alert.alert('No es comida', 'No hemos reconocido un plato en la foto. Prueba con otra imagen.');
      return;
    }

    track('photo_scan_error', { message: res.message });
    setState((s) => ({ ...s, analyzing: false }));
    Alert.alert('No se pudo analizar', res.message);
  }, []);

  return { ...state, capture, reset, clearQuota };
}
