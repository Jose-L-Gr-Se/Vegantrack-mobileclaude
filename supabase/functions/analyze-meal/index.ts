/**
 * analyze-meal — Edge Function de Supabase (Deno).
 *
 * Analiza la foto de un plato con Google Gemini (visión) y devuelve macros
 * estimados. Análisis nutricional GENERAL para cualquier persona: no rechaza
 * platos con carne, pescado, huevo o lácteos; la info vegana es un dato
 * opcional. La API key de Gemini vive sólo aquí (secret), nunca en la APK.
 *
 * Protecciones de coste (anti-abuso):
 *   - Cuota diaria por usuario (free / pro distintos).
 *   - Rate limit por usuario y minuto (anti-bot).
 *   - Tope global diario para TODA la app (kill-switch).
 *   - Validación de tamaño/MIME de la imagen.
 *
 * Secrets (supabase secrets set ...):
 *   GEMINI_API_KEY (obligatoria), GEMINI_MODEL (opcional)
 *   FREE_DAILY_SCANS (def. 1), PRO_DAILY_SCANS (def. 100, anti-bot invisible)
 *   RATE_LIMIT_PER_MIN (def. 5), GLOBAL_DAILY_LIMIT (def. 2000)
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';
const FREE_DAILY_SCANS = Number(Deno.env.get('FREE_DAILY_SCANS') ?? '1');
const PRO_DAILY_SCANS = Number(Deno.env.get('PRO_DAILY_SCANS') ?? '100');
const RATE_LIMIT_PER_MIN = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '5');
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get('GLOBAL_DAILY_LIMIT') ?? '2000');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `Analiza la foto de comida para una app de nutrición general que usa todo tipo de personas (no sólo veganas).
Estima el plato más probable, los ingredientes visibles, los gramos aproximados del plato y los valores nutricionales POR 100 g (calorías, proteínas, carbohidratos, grasas, fibra, azúcares y grasas saturadas).
No rechaces ni penalices platos por llevar carne, pescado, huevo, lácteos, miel u otros ingredientes de origen animal: simplemente analízalos.
Indica si el plato es vegano (is_vegan) sólo como dato informativo. Si ves ingredientes posiblemente NO veganos, repórtalos en non_vegan_ingredients como información opcional, sin juzgar.
Si no estás seguro de algo, indícalo (vegan_confidence más baja, o una nota breve); no inventes datos.
Si la imagen no es comida, responde is_food=false.
Devuelve ÚNICAMENTE el JSON con el contrato esperado.`;

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
    p &&
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

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return json({ error: 'No autorizado' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Sesión no válida' }, 401);
    const userId = userData.user.id;

    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || typeof image_base64 !== 'string') {
      return json({ error: 'Falta la imagen' }, 400);
    }

    const mime = (mime_type || 'image/jpeg').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return json({ error: 'Formato no soportado' }, 400);
    }
    const approxBytes = Math.floor(image_base64.length * 0.75);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return json({ error: 'Imagen demasiado grande' }, 413);
    }

    const today = todayUTC();
    const { count: globalToday } = await supabase
      .from('meal_scans')
      .select('id', { count: 'exact', head: true })
      .eq('date', today);
    if ((globalToday ?? 0) >= GLOBAL_DAILY_LIMIT) {
      console.warn('GLOBAL DAILY LIMIT reached:', globalToday);
      return json({ error: 'service_unavailable', retry_after: 'tomorrow' }, 503);
    }

    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: lastMinute } = await supabase
      .from('meal_scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneMinAgo);
    if ((lastMinute ?? 0) >= RATE_LIMIT_PER_MIN) {
      return json({ error: 'rate_limited', retry_after_seconds: 60 }, 429);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_expires_at')
      .eq('id', userId)
      .single();

    const isPro =
      profile?.subscription_tier === 'pro' &&
      (!profile.subscription_expires_at ||
        new Date(profile.subscription_expires_at).getTime() > Date.now());

    const dailyLimit = isPro ? PRO_DAILY_SCANS : FREE_DAILY_SCANS;

    const { count: usedTodayCount } = await supabase
      .from('meal_scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('date', today);
    const usedToday = usedTodayCount ?? 0;
    if (usedToday >= dailyLimit) {
      return json(
        { error: 'quota_exceeded', remaining: 0, limit: dailyLimit, is_pro: isPro },
        402
      );
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'IA no configurada' }, 500);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const aiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: mime, data: image_base64 } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => '');
      console.error('Gemini error:', aiRes.status, detail);
      return json({ error: 'No se pudo analizar la imagen' }, 502);
    }

    const aiJson = await aiRes.json();
    const text = aiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      console.error('Gemini sin texto, finishReason:', aiJson?.candidates?.[0]?.finishReason);
      return json({ error: 'La IA no devolvió un resultado. Prueba con otra foto.' }, 502);
    }

    let result: any;
    try {
      result = parseJson(text);
    } catch {
      console.error('Parse error, raw:', text);
      return json({ error: 'Respuesta de IA no interpretable' }, 502);
    }

    if (!isValidAnalysis(result)) {
      console.error('Contrato inválido:', JSON.stringify(result));
      return json({ error: 'La IA no devolvió un análisis válido. Prueba con otra foto.' }, 502);
    }

    if (!result.is_food) {
      return json({ error: 'no_food', message: 'No parece un plato de comida.' }, 422);
    }

    if (!Array.isArray(result.non_vegan_ingredients)) result.non_vegan_ingredients = [];
    if (typeof result.vegan_confidence !== 'string') result.vegan_confidence = 'unknown';

    await supabase.from('meal_scans').insert({ user_id: userId, date: today });
    void supabase
      .from('analytics_events')
      .insert({
        user_id: userId,
        event: 'meal_analyzed',
        props: { model: MODEL, is_vegan: result.is_vegan, vegan_confidence: result.vegan_confidence, is_pro: isPro },
      })
      .then(() => undefined, () => undefined);

    const remaining = Math.max(0, dailyLimit - (usedToday + 1));
    return json({ result, remaining, limit: dailyLimit, is_pro: isPro });
  } catch (err: any) {
    console.error('analyze-meal error:', err);
    return json({ error: err?.message ?? 'Error interno' }, 500);
  }
});
