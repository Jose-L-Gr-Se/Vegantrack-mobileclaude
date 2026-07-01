import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { analyzeMealPhoto, analysisToFood, type MealAnalysis, type ScanPeriod } from '@/lib/mealVision';
import { track } from '@/lib/analytics';
import type { FoodPer100g, VeganConfidence } from '@/types';

export interface MealPhotoError {
  title: string;
  body: string;
}

interface MealPhotoState {
  analyzing: boolean;
  food: FoodPer100g | null;
  analysis: MealAnalysis | null;
  grams: number;
  confidence: VeganConfidence | undefined;
  remaining: number | null;
  limit: number;
  period: ScanPeriod;
  quotaBlocked: boolean;
  error: MealPhotoError | null;
}

const INITIAL: MealPhotoState = {
  analyzing: false,
  food: null,
  analysis: null,
  grams: 100,
  confidence: undefined,
  remaining: null,
  limit: 1,
  period: 'week',
  quotaBlocked: false,
  error: null,
};

export function useMealPhoto() {
  const [state, setState] = useState<MealPhotoState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);
  const clearQuota = useCallback(() => setState((s) => ({ ...s, quotaBlocked: false })), []);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  const capture = useCallback(async (source: 'camera' | 'library') => {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      Alert.alert(
        'Permiso necesario',
        source === 'camera'
          ? 'Activa el permiso de cámara en Ajustes para fotografiar tu plato.'
          : 'Activa el permiso de fotos en Ajustes para elegir una imagen.',
        [{ text: 'Entendido' }]
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      base64: true,
      quality: 0.65,
      allowsEditing: true,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];

    track('photo_scan_started', { source });
    setState((s) => ({ ...s, analyzing: true, error: null }));

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
        period: res.period,
        quotaBlocked: false,
        error: null,
      });
      return;
    }

    if (res.reason === 'quota') {
      track('photo_scan_quota_blocked', { limit: res.limit });
      setState((s) => ({ ...s, analyzing: false, quotaBlocked: true, remaining: 0, limit: res.limit, period: res.period, error: null }));
      return;
    }

    track('photo_scan_error', { reason: res.reason, message: (res as any).message });

    const errorMap: Record<string, MealPhotoError> = {
      rate_limit: {
        title: 'Demasiado rápido',
        body: 'Has hecho varios análisis seguidos. Espera un minuto y vuelve a intentarlo.',
      },
      ai_quota_exceeded: {
        title: 'IA saturada momentáneamente',
        body: 'Los servidores de Google están con alta demanda. Espera unos segundos e inténtalo de nuevo.',
      },
      global_block: {
        title: 'Análisis no disponible',
        body: 'El análisis con IA está temporalmente saturado. Prueba en unos minutos o añade el alimento manualmente.',
      },
      no_food: {
        title: 'No hemos visto comida',
        body: 'Asegúrate de que el plato se ve con claridad y sin objetos que lo tapen.',
      },
    };

    const err: MealPhotoError = errorMap[res.reason] ?? {
      title: 'No se pudo analizar',
      body: (res as any).message ?? 'Algo salió mal. Prueba con otra foto o con mejor iluminación.',
    };

    setState((s) => ({ ...s, analyzing: false, error: err }));
  }, []);

  return { ...state, capture, reset, clearQuota, clearError };
}
