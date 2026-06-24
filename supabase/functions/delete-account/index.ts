/**
 * delete-account — Edge Function de Supabase (Deno).
 *
 * Elimina permanentemente la cuenta del usuario autenticado y todos sus datos
 * (ON DELETE CASCADE en profiles, food_log, weight_logs, etc.).
 * Usa service_role para poder llamar a auth.admin.deleteUser; la service_role
 * key nunca sale de aquí.
 *
 * La llama la propia app móvil tras confirmación explícita del usuario.
 * Google Play exige que exista esta opción in-app desde 2023.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    const { error } = await supabase.auth.admin.deleteUser(userData.user.id);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (err: any) {
    console.error('delete-account error:', err);
    return json({ error: err?.message ?? 'Error interno' }, 500);
  }
});
