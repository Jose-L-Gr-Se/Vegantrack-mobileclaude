/**
 * send-email — Edge Function de Supabase (Deno).
 *
 * Envía emails transaccionales de VegeTrack vía Resend.
 * La app lo llama tras el registro y tras finalizar el onboarding.
 *
 * Tipos soportados:
 *   signup   → email de bienvenida al crear cuenta
 *   welcome  → plan personalizado tras completar el onboarding
 *
 * Secrets requeridos:
 *   RESEND_API_KEY — clave de API de Resend (resend.com)
 *
 * Body JSON esperado:
 *   { type: 'signup' | 'welcome', name?: string,
 *     calories?: number, protein_g?: number, carbs_g?: number, fat_g?: number }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  sendEmail,
  buildSignupEmail,
  buildWelcomeEmail,
} from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type EmailType = 'signup' | 'welcome';

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

    const userEmail = userData.user.email;
    if (!userEmail) return json({ error: 'El usuario no tiene email' }, 400);

    const body = await req.json() as {
      type: EmailType;
      name?: string;
      calories?: number;
      protein_g?: number;
      carbs_g?: number;
      fat_g?: number;
    };

    let template: { subject: string; html: string };

    if (body.type === 'signup') {
      template = buildSignupEmail(body.name);
    } else if (body.type === 'welcome') {
      template = buildWelcomeEmail({
        name: body.name,
        calories: body.calories,
        protein_g: body.protein_g,
        carbs_g: body.carbs_g,
        fat_g: body.fat_g,
      });
    } else {
      return json({ error: 'Tipo de email no válido' }, 400);
    }

    const sent = await sendEmail({ to: userEmail, ...template });
    return json({ ok: true, sent });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('send-email error:', msg);
    return json({ error: msg }, 500);
  }
});
