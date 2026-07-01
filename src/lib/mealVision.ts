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
