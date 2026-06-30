/**
 * analyze-meal — Edge Function de Supabase (Deno).
 *
 * Analiza la foto de un plato con Google Gemini (visión) y devuelve macros
 * estimados. Análisis nutricional GENERAL para cualquier persona.
 *
 * Secrets:
 *   GEMINI_API_KEY (obligatoria), GEMINI_MODEL (opcional, default gemini-2.0-flash)
 *   FREE_DAILY_SCANS (def. 1), PRO_DAILY_SCANS (def. 100)
 *   RATE_LIMIT_PER_MIN (def. 5), GLOBAL_DAILY_LIMIT (def. 2000)
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const PRIMARY_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';
// Fallback chain: gemini-2.5-flash-lite → gemini-1.5-flash → gemini-1.5-flash-8b
// gemini-1.5-flash and gemini-1.5-flash-8b are the stable, reliably-available
// free-tier vision models (15 RPM, 1M TPD). gemini-2.0-flash-lite has limit=0
// on some API keys so it is intentionally NOT in this chain.
const FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b'];
const FREE_DAILY_SCANS = Number(Deno.env.get('FREE_DAILY_SCANS') ?? '1');
const PRO_DAILY_SCANS = Number(Deno.env.get('PRO_DAILY_SCANS') ?? '100');
const RATE_LIMIT_PER_MIN = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '5');
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get('GLOBAL_DAILY_LIMIT') ?? '2000');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']);
const GEMINI_TIMEOUT_MS = 15_000; // 15 s per call; with 3 models worst-case ~45 s total

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `Analiza la foto de comida para una app de nutrición general que usa todo tipo de personas (no sólo veganas).
Estima el plato más probable, los ingredientes visibles, los gramos aproximados del plato y los valores nutricionales POR 100 g (calorías, proteínas, carbohidratos, grasas, fibra, azúcares y grasas saturadas).
No rechaces ni penalices platos por llevar carne, pescado, huevo, lácteos, miel u otros ingredientes de origen animal: simplemente analízalos.
Indica si el plato es vegano (is_vegan) sólo como dato informativo. Si ves ingredientes posiblemente NO veganos, repórtalos en non_vegan_ingredients como información opcional, sin juzgar.
Si no estás seguro de algo, indícalo en notes; no inventes datos.
Si la imagen no es comida, responde is_food=false y pon food_name="".
Devuelve ÚNICAMENTE JSON válido con el contrato indicado.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    is_food: { type: 'boolean' },
    food_name: { type: 'string' },
    estimated_grams: { type: 'number' },
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
  required: ['is_food', 'food_name', 'estimated_grams', 'per_100g', 'is_vegan', 'vegan_confidence', 'non_vegan_ingredients'],
};

type GeminiResult =
  | { ok: true; text: string; model: string }
  | { ok: false; status: number; detail: string; finishReason?: string };

async function callGemini(model: string, base64: string, mime: string, apiKey: string): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mime, data: base64 } },
            { text: PROMPT },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
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
    const candidate = j?.candidates?.[0];
    const finishReason: string = candidate?.finishReason ?? '';

    // Extract text from whichever part contains it
    const text: string =
      candidate?.content?.parts?.find((p: any) => typeof p.text === 'string')?.text ?? '';

    if (!text) {
      const detail = `finishReason=${finishReason} | promptFeedback=${JSON.stringify(j?.promptFeedback)}`;
      console.error(`[Gemini] ${model} empty text —`, detail);
      return { ok: false, status: 0, detail, finishReason };
    }

    console.log(`[Gemini] ${model} OK, finishReason=${finishReason}, chars=${text.length}`);
    return { ok: true, text, model };
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

function isValidAnalysis(r: any): boolean {
  if (!r || typeof r.is_food !== 'boolean') return false;
  if (!r.is_food) return true;
  const p = r.per_100g;
  return (
    typeof r.food_name === 'string' &&
    typeof r.estimated_grams === 'number' &&
    p != null &&
    typeof p.calories === 'number' &&
    typeof p.protein_g === 'number' &&
    typeof p.carbs_g === 'number' &&
    typeof p.fat_g === 'number'
  );
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
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

    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || typeof image_base64 !== 'string') {
      return respond({ error: 'Falta la imagen' }, 400);
    }

    const mime = (mime_type || 'image/jpeg').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) return respond({ error: 'Formato no soportado' }, 400);

    const approxBytes = Math.floor(image_base64.length * 0.75);
    if (approxBytes > MAX_IMAGE_BYTES) return respond({ error: 'Imagen demasiado grande' }, 413);

    const today = todayUTC();

    // Global kill-switch
    const { count: globalToday } = await supabase
      .from('meal_scans').select('id', { count: 'exact', head: true }).eq('date', today);
    if ((globalToday ?? 0) >= GLOBAL_DAILY_LIMIT) {
      console.warn('[quota] global limit reached:', globalToday);
      return respond({ error: 'service_unavailable', retry_after: 'tomorrow' }, 503);
    }

    // Per-user rate limit (1 min)
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: lastMinute } = await supabase
      .from('meal_scans').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', oneMinAgo);
    if ((lastMinute ?? 0) >= RATE_LIMIT_PER_MIN) {
      return respond({ error: 'rate_limited', retry_after_seconds: 60 }, 429);
    }

    // Pro check
    const { data: profile } = await supabase
      .from('profiles').select('subscription_tier, subscription_expires_at')
      .eq('id', userId).single();
    const isPro =
      profile?.subscription_tier === 'pro' &&
      (!profile.subscription_expires_at ||
        new Date(profile.subscription_expires_at).getTime() > Date.now());

    const dailyLimit = isPro ? PRO_DAILY_SCANS : FREE_DAILY_SCANS;

    // Per-user daily quota
    const { count: usedTodayCount } = await supabase
      .from('meal_scans').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('date', today);
    const usedToday = usedTodayCount ?? 0;
    if (usedToday >= dailyLimit) {
      return respond({ error: 'quota_exceeded', remaining: 0, limit: dailyLimit, is_pro: isPro }, 402);
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return respond({ error: 'IA no configurada' }, 500);

    // Try primary model, then each fallback in sequence until one succeeds.
    // On 503 (overloaded) or 429 (quota exhausted) we move to the next model.
    const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter(m => m !== PRIMARY_MODEL)];
    let gemini = await callGemini(modelsToTry[0], image_base64, mime, apiKey);
    for (let i = 1; i < modelsToTry.length && !gemini.ok; i++) {
      console.warn(`[Gemini] ${modelsToTry[i - 1]} failed (status=${gemini.status}), trying ${modelsToTry[i]}`);
      gemini = await callGemini(modelsToTry[i], image_base64, mime, apiKey);
    }

    if (!gemini.ok) {
      // Distinguish user-side rate limit (our DB check above) from API-side quota issues
      if (gemini.status === 429) return respond({ error: 'ai_quota_exceeded', retry_after_seconds: 60 }, 503);
      if (gemini.finishReason === 'SAFETY') {
        return respond({ error: 'La imagen no pudo ser procesada. Prueba con otra foto.' }, 422);
      }
      return respond({ error: 'No se pudo analizar la imagen' }, 502);
    }

    let result: any;
    try {
      result = parseJson(gemini.text);
    } catch {
      console.error('[parse] raw text:', gemini.text.slice(0, 300));
      return respond({ error: 'Respuesta de IA no interpretable' }, 502);
    }

    if (!isValidAnalysis(result)) {
      console.error('[validate] contrato inválido:', JSON.stringify(result).slice(0, 300));
      return respond({ error: 'La IA no devolvió un análisis válido. Prueba con otra foto.' }, 502);
    }

    if (!result.is_food) {
      return respond({ error: 'no_food', message: 'No parece un plato de comida.' }, 422);
    }

    if (!Array.isArray(result.non_vegan_ingredients)) result.non_vegan_ingredients = [];
    if (typeof result.vegan_confidence !== 'string') result.vegan_confidence = 'unknown';

    await supabase.from('meal_scans').insert({ user_id: userId, date: today });
    void supabase.from('analytics_events').insert({
      user_id: userId,
      event: 'meal_analyzed',
      props: { model: gemini.model, is_vegan: result.is_vegan, vegan_confidence: result.vegan_confidence, is_pro: isPro },
    }).then(() => undefined, () => undefined);

    const remaining = Math.max(0, dailyLimit - (usedToday + 1));
    return respond({ result, remaining, limit: dailyLimit, is_pro: isPro });

  } catch (err: any) {
    console.error('[analyze-meal] unhandled error:', err?.message ?? err);
    return respond({ error: err?.message ?? 'Error interno' }, 500);
  }
});
