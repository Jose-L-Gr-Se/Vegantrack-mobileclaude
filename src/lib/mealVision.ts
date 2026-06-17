/**
 * Cliente de "VeganLens": envía la foto de un plato a la función servidor
 * `/api/analyze-meal` (que llama a Claude con visión) y normaliza la respuesta
 * al formato común `FoodPer100g` para reutilizar la ficha de producto y el alta
 * en el diario. La API key de IA vive en el servidor, nunca en el cliente.
 */
import { supabase, WEB_BASE_URL } from '@/lib/supabase';
import type { FoodPer100g, VeganConfidence } from '@/types';

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

export type AnalyzeResult =
  | { ok: true; analysis: MealAnalysis; remaining: number | null; limit: number }
  | { ok: false; reason: 'quota'; limit: number }
  | { ok: false; reason: 'no_food' }
  | { ok: false; reason: 'error'; message: string };

export async function analyzeMealPhoto(base64: string, mime: string): Promise<AnalyzeResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'error', message: 'Sesión no válida' };

  try {
    const res = await fetch(`${WEB_BASE_URL}/api/analyze-meal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image_base64: base64, mime_type: mime }),
    });

    if (res.status === 402) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, reason: 'quota', limit: j.limit ?? 3 };
    }
    if (res.status === 422) {
      return { ok: false, reason: 'no_food' };
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, reason: 'error', message: j.error ?? `Error ${res.status}` };
    }

    const j = await res.json();
    return { ok: true, analysis: j.result as MealAnalysis, remaining: j.remaining ?? null, limit: j.limit ?? 3 };
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
