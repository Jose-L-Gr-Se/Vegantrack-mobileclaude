/**
 * correct-meal — Edge Function de Supabase (Deno).
 *
 * Permite a usuarios PRO corregir un análisis de plato ya hecho por IA
 * (p.ej. "es heura, no atún") y recalcula los macros por 100 g para el
 * alimento corregido. Sólo texto, sin imagen — no consume la cuota de
 * escaneos de foto (esa es para el análisis inicial con visión).
 *
 * Secrets: GEMINI_API_KEY (obligatoria), GEMINI_MODEL (opcional)
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const PRIMARY_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';
const FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b'];
const GEMINI_TIMEOUT_MS = 15_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    food_name: { type: 'string' },
    per_100g: {
      type: 'object',
      properties: {
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        fiber_g: { type: 'number' },
        sugar_g: { type: 'number' },
        saturated_fat_g: { type: 'number' },
      },
      required: ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'saturated_fat_g'],
    },
    is_vegan: { type: 'boolean' },
    vegan_confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
    non_vegan_ingredients: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['food_name', 'per_100g', 'is_vegan', 'vegan_confidence', 'non_vegan_ingredients'],
};

function buildPrompt(foodName: string): string {
  return `Un usuario ha corregido la identificación de un plato de comida. El plato correcto es: "${foodName}".
Estima los valores nutricionales POR 100 g (calorías, proteínas, carbohidratos, grasas, fibra, azúcares y grasas saturadas) para ese alimento/plato.
Indica si es vegano (is_vegan) sólo como dato informativo. Si tiene ingredientes posiblemente NO veganos, repórtalos en non_vegan_ingredients sin juzgar.
Si no estás seguro de algo, indícalo en notes; no inventes datos.
IMPORTANTE: responde SIEMPRE en español.
Devuelve ÚNICAMENTE JSON válido con el contrato indicado.`;
}

type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; status: number; detail: string };

async function callGemini(model: string, prompt: string, apiKey: string): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[Gemini] ${model} HTTP ${res.status}:`, detail.slice(0, 500));
      return { ok: false, status: res.status, detail };
    }

    const j = await res.json();
    const text: string =
      j?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')?.text ?? '';
    if (!text) return { ok: false, status: 0, detail: 'empty response' };
    return { ok: true, text };
  } catch (e: any) {
    clearTimeout(timer);
    const detail = e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'fetch error');
    console.error(`[Gemini] ${model} fetch error:`, detail);
    return { ok: false, status: 0, detail };
  }
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned);
}

function isValidResult(r: any): boolean {
  const p = r?.per_100g;
  return (
    typeof r?.food_name === 'string' &&
    p != null &&
    typeof p.calories === 'number' &&
    typeof p.protein_g === 'number' &&
    typeof p.carbs_g === 'number' &&
    typeof p.fat_g === 'number'
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return respond({ error: 'No autorizado' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) return respond({ error: 'Sesión no válida' }, 401);
    const userId = userData.user.id;

    const { data: profile } = await supabase
      .from('profiles').select('subscription_tier, subscription_expires_at')
      .eq('id', userId).single();
    const isPro =
      profile?.subscription_tier === 'pro' &&
      (!profile.subscription_expires_at ||
        new Date(profile.subscription_expires_at).getTime() > Date.now());
    if (!isPro) return respond({ error: 'pro_required' }, 403);

    const { food_name } = await req.json();
    if (!food_name || typeof food_name !== 'string' || food_name.trim().length < 2) {
      return respond({ error: 'Falta el nombre del plato corregido' }, 400);
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return respond({ error: 'IA no configurada' }, 500);

    const prompt = buildPrompt(food_name.trim().slice(0, 200));
    const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
    let gemini = await callGemini(modelsToTry[0], prompt, apiKey);
    for (let i = 1; i < modelsToTry.length && !gemini.ok; i++) {
      gemini = await callGemini(modelsToTry[i], prompt, apiKey);
    }

    if (!gemini.ok) {
      if (gemini.status === 429) return respond({ error: 'ai_quota_exceeded', retry_after_seconds: 60 }, 503);
      return respond({ error: 'No se pudo recalcular el plato' }, 502);
    }

    let result: any;
    try {
      result = parseJson(gemini.text);
    } catch {
      return respond({ error: 'Respuesta de IA no interpretable' }, 502);
    }

    if (!isValidResult(result)) {
      return respond({ error: 'La IA no devolvió un resultado válido' }, 502);
    }

    if (!Array.isArray(result.non_vegan_ingredients)) result.non_vegan_ingredients = [];
    if (typeof result.vegan_confidence !== 'string') result.vegan_confidence = 'unknown';

    return respond({ result });
  } catch (err: any) {
    console.error('[correct-meal] unhandled error:', err?.message ?? err);
    return respond({ error: err?.message ?? 'Error interno' }, 500);
  }
});
