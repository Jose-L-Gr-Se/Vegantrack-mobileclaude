import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { analyzeMealPhoto, analysisToFood, correctVeganManually, type MealAnalysis, type ScanPeriod } from '@/lib/mealVision';
import { track } from '@/lib/analytics';
import type { FoodPer100g, VeganConfidence } from '@/types';

export interface MealPhotoError {
  title: string;
  body: string;
  /**
   * Auditoría del flujo de foto-IA: `no_food` es la única razón por la que
   * repetir con la MISMA foto fallaría otra vez con toda seguridad (si la IA
   * no vio comida, no la va a ver la segunda vez) — para esa hay que volver
   * a elegir/hacer una foto distinta. El resto (límite de peticiones por
   * minuto, IA saturada, corte global, fallo de red/parseo) son fallos del
   * lado del servidor ajenos a la foto en sí: obligar a repetir todo el
   * paso de cámara/galería para volver a intentar exactamente lo mismo es
   * trabajo de más, y no cuesta cuota (`analyze-meal` sólo descuenta la
   * cuota semanal/diaria en un análisis que termina con éxito).
   */
  retryable: boolean;
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
  // Última foto analizada (para poder reintentar un fallo transitorio del
  // servidor sin obligar a repetir todo el paso de cámara/galería). En un
  // ref, no en `state`: no necesita causar un re-render por sí sola, y
  // `retry()` la lee de forma síncrona.
  const lastAssetRef = useRef<{ base64: string; mime: string } | null>(null);

  const reset = useCallback(() => setState(INITIAL), []);
  const clearQuota = useCallback(() => setState((s) => ({ ...s, quotaBlocked: false })), []);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  /** Llama a `analyze-meal` con una foto ya elegida e interpreta el
   * resultado — compartido por `capture()` (foto nueva) y `retry()` (misma
   * foto tras un fallo transitorio), para que ambas midan y reaccionen
   * exactamente igual ante éxito/cuota/error. */
  const runAnalysis = useCallback(async (base64: string, mime: string) => {
    lastAssetRef.current = { base64, mime };
    setState((s) => ({ ...s, analyzing: true, error: null }));

    const res = await analyzeMealPhoto(base64, mime);

    if (res.ok) {
      // Auditoría de privacidad del funnel: nunca contenido de comida en
      // analítica, ni siquiera el nombre (podía revelar datos de salud
      // indirectos — alergias, embarazo, patrones alimentarios).
      track('photo_scan_success', {
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
        retryable: true,
      },
      ai_quota_exceeded: {
        title: 'IA saturada momentáneamente',
        body: 'Los servidores de Google están con alta demanda. Espera unos segundos e inténtalo de nuevo.',
        retryable: true,
      },
      global_block: {
        title: 'Análisis no disponible',
        body: 'El análisis con IA está temporalmente saturado. Prueba en unos minutos o añade el alimento manualmente.',
        retryable: true,
      },
      no_food: {
        title: 'No hemos visto comida',
        body: 'Asegúrate de que el plato se ve con claridad y sin objetos que lo tapen.',
        retryable: false,
      },
    };

    const err: MealPhotoError = errorMap[res.reason] ?? {
      title: 'No se pudo analizar',
      body: (res as any).message ?? 'Algo salió mal. Prueba con otra foto o con mejor iluminación.',
      retryable: true,
    };

    setState((s) => ({ ...s, analyzing: false, error: err }));
  }, []);

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
    await runAnalysis(asset.base64!, asset.mimeType ?? 'image/jpeg');
  }, [runAnalysis]);

  /**
   * Reintenta el análisis con la ÚLTIMA foto, sin volver a pasar por
   * cámara/galería — sólo tiene sentido para un fallo transitorio del
   * servidor (`error.retryable`, ver `MealPhotoError`); `no_food` exige una
   * foto distinta. No emite `photo_scan_started`: no se ha vuelto a elegir
   * ninguna fuente, sólo se repite el mismo envío.
   */
  const retry = useCallback(async () => {
    const last = lastAssetRef.current;
    if (!last) return;
    await runAnalysis(last.base64, last.mime);
  }, [runAnalysis]);

  /** Sustituye el análisis por el recalculado tras una corrección Pro. */
  const applyCorrection = useCallback((analysis: MealAnalysis) => {
    setState((s) => ({
      ...s,
      analysis,
      food: analysisToFood(analysis),
      confidence: analysis.vegan_confidence,
    }));
  }, []);

  /**
   * Corrección manual (gratis, sin IA) de si el plato es vegano — auditoría
   * del paywall de foto-IA, cierre del P1. A diferencia de `applyCorrection`
   * (que sustituye TODO el análisis tras un recálculo Pro), esto sólo toca
   * is_vegan/vegan_confidence/non_vegan_ingredients (ver `correctVeganManually`),
   * y nunca llama a Gemini. Limpiar `non_vegan_ingredients` al marcar vegano
   * evita que el aviso de "posibles ingredientes de origen animal" (derivado
   * de este mismo campo en DiaryScreen) contradiga la corrección del usuario.
   */
  const applyManualVeganCorrection = useCallback((isVegan: boolean) => {
    setState((s) => {
      if (!s.analysis) return s;
      const analysis = correctVeganManually(s.analysis, isVegan);
      return { ...s, analysis, food: analysisToFood(analysis), confidence: analysis.vegan_confidence };
    });
  }, []);

  return { ...state, capture, retry, reset, clearQuota, clearError, applyCorrection, applyManualVeganCorrection };
}
