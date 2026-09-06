/**
 * Cliente de "VeganLens": envía la foto de un plato a la Edge Function
 * de Supabase (`analyze-meal`) y normaliza la respuesta al formato común
 * `FoodPer100g`. La API key de Gemini vive en el servidor, nunca en el cliente.
 */
import { supabase } from '@/lib/supabase';
import type { FoodPer100g, VeganConfidence } from '@/types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface MealAnalysis {
  is_food: boolean;
  food_name: string;
  estimated_grams: number;
  per_100g: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sugar_g: number;
    saturated_fat_g: number;
  };
  is_vegan: boolean;
  vegan_confidence: VeganConfidence;
  non_vegan_ingredients: string[];
  notes?: string;
}

export type ScanPeriod = 'day' | 'week';

export type AnalyzeResult =
  | { ok: true; analysis: MealAnalysis; remaining: number; limit: number; period: ScanPeriod; isPro: boolean }
  | { ok: false; reason: 'quota'; limit: number; period: ScanPeriod; isPro: boolean }
  | { ok: false; reason: 'rate_limit' }
  | { ok: false; reason: 'global_block' }
  | { ok: false; reason: 'no_food' }
  | { ok: false; reason: 'error'; message: string };

export async function analyzeMealPhoto(base64: string, mime: string): Promise<AnalyzeResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'error', message: 'Sesión no válida' };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-meal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image_base64: base64, mime_type: mime }),
    });

    if (res.status === 402) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, reason: 'quota', limit: j.limit ?? 1, period: j.period ?? 'week', isPro: !!j.is_pro };
    }
    if (res.status === 429) return { ok: false, reason: 'rate_limit' };
    if (res.status === 503) return { ok: false, reason: 'global_block' };
    if (res.status === 422) return { ok: false, reason: 'no_food' };
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, reason: 'error', message: j.error ?? `Error ${res.status}` };
    }

    const j = await res.json();
    return {
      ok: true,
      analysis: j.result as MealAnalysis,
      remaining: j.remaining ?? 0,
      limit: j.limit ?? 1,
      period: j.period ?? 'week',
      isPro: !!j.is_pro,
    };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message ?? 'Error de red' };
  }
}

export type CorrectResult =
  | { ok: true; analysis: MealAnalysis }
  | { ok: false; reason: 'not_pro' }
  | { ok: false; reason: 'error'; message: string };

/**
 * Corrige un análisis de foto ya hecho (p.ej. "es heura, no atún") y recalcula
 * los macros por 100 g. Sólo texto, sin volver a analizar la imagen — no
 * consume la cuota de escaneos. Sólo disponible para usuarios Pro (el server
 * vuelve a comprobarlo).
 */
export async function correctMealAnalysis(
  correctedFoodName: string,
  previous: MealAnalysis
): Promise<CorrectResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'error', message: 'Sesión no válida' };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/correct-meal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ food_name: correctedFoodName }),
    });

    if (res.status === 403) return { ok: false, reason: 'not_pro' };
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, reason: 'error', message: j.error ?? `Error ${res.status}` };
    }

    const j = await res.json();
    const r = j.result;
    return {
      ok: true,
      analysis: {
        is_food: true,
        food_name: r.food_name,
        estimated_grams: previous.estimated_grams,
        per_100g: r.per_100g,
        is_vegan: r.is_vegan,
        vegan_confidence: r.vegan_confidence,
        non_vegan_ingredients: r.non_vegan_ingredients ?? [],
        notes: r.notes,
      },
    };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message ?? 'Error de red' };
  }
}

/**
 * Aplica una corrección manual (gratis, sin IA) de si un plato ya analizado
 * es vegano. Pura y sin estado — vive aquí (no dentro de `useMealPhoto`)
 * para poder testearla directamente: en este repo, `@testing-library/
 * react-native`/`renderHook` no son fiables (React 19 + RNTL 14, ver
 * precedente en ErrorBoundary.test.tsx / SupplementEditor.dosePresentation.test.ts).
 *
 * Auditoría del paywall de foto-IA (P1): `is_vegan`/`vegan_confidence` no
 * tenían ninguna vía de corrección sin Pro, a diferencia de las macros
 * (que ya se podían corregir a mano si la IA las estimaba mal). Distinta de
 * `correctMealAnalysis`: nunca llama a Gemini, no cuesta nada, y sólo toca
 * estos tres campos — el resto del análisis (nombre, macros) no cambia.
 *
 * 'high'/'low' son las mismas categorías que ya usa la UI para "muy
 * probablemente vegano"/"no vegano" (ver Pill en ProductDetailSheet) — no
 * un número inventado: una afirmación directa del usuario es al menos tan
 * fiable como cualquier heurística de IA/OFF que ya dispara esas mismas
 * etiquetas. Al marcar vegano se limpia `non_vegan_ingredients`: ya no hay
 * ningún ingrediente no vegano que listar.
 */
export function correctVeganManually(analysis: MealAnalysis, isVegan: boolean): MealAnalysis {
  return {
    ...analysis,
    is_vegan: isVegan,
    vegan_confidence: manualVeganConfidence(isVegan),
    non_vegan_ingredients: isVegan ? [] : analysis.non_vegan_ingredients,
  };
}

/**
 * `vegan_confidence` que corresponde a una corrección manual del usuario
 * (ver `correctVeganManually`) — única fuente de verdad de este mapeo, para
 * que `ProductDetailSheet` (que no maneja un `MealAnalysis` completo al
 * corregir un producto sin `analysis`, sólo `is_vegan`) use exactamente el
 * mismo criterio sin repetirlo.
 */
export function manualVeganConfidence(isVegan: boolean): VeganConfidence {
  return isVegan ? 'high' : 'low';
}

/** Normaliza la estimación de la IA al formato común por-100g. */
export function analysisToFood(a: MealAnalysis): FoodPer100g {
  const p = a.per_100g;
  return {
    food_name: a.food_name,
    brand: 'Foto IA',
    barcode: null,
    image_url: null,
    is_vegan: a.is_vegan,
    source: 'ai_photo',
    source_ref: null,
    calories: p.calories ?? 0,
    protein_g: p.protein_g ?? 0,
    carbs_g: p.carbs_g ?? 0,
    fat_g: p.fat_g ?? 0,
    fiber_g: p.fiber_g ?? 0,
    sugar_g: p.sugar_g ?? 0,
    saturated_fat_g: p.saturated_fat_g ?? 0,
    sodium_mg: 0,
    vitamin_b12_mcg: null,
    iron_mg: null,
    zinc_mg: null,
    calcium_mg: null,
    omega3_g: null,
    vitamin_d_mcg: null,
    vitamin_b12_known: false,
    iron_known: false,
    zinc_known: false,
    calcium_known: false,
    omega3_known: false,
    vitamin_d_known: false,
  };
}
