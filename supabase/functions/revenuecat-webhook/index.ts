/**
 * revenuecat-webhook — Edge Function de Supabase (Deno).
 *
 * Recibe los eventos de RevenueCat (Play Billing) y sincroniza el estado Pro
 * en `profiles` para que TODO el backend (p. ej. la cuota de la IA en
 * analyze-meal, que lee profiles.subscription_tier) sepa quién es Pro.
 *
 * RevenueCat manda un header Authorization con un secreto que defines tú.
 * Por eso esta función se despliega con verify_jwt=false y valida ese secreto
 * a mano (igual que un webhook de Stripe). El app_user_id de RevenueCat debe
 * ser el id de usuario de Supabase (la app llamará a Purchases.logIn(userId)).
 *
 * Secrets:
 *   REVENUECAT_WEBHOOK_AUTH (obligatorio): el mismo valor que pongas en
 *     RevenueCat → Project settings → Webhooks → Authorization header.
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

// Eventos que dan/renuevan acceso Pro.
const PRO_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'NON_RENEWING_PURCHASE',
  'TRANSFER',
]);
// Eventos que quitan el acceso (la suscripción ya expiró de verdad).
const FREE_EVENTS = new Set(['EXPIRATION']);
// CANCELLATION / BILLING_ISSUE NO bajan a free: el usuario sigue siendo Pro
// hasta que llegue EXPIRATION al final del periodo ya pagado.

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authSecret = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  const provided = req.headers.get('Authorization') ?? '';
  if (!authSecret || provided !== authSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 });
  }

  const event = body?.event;
  const userId: string | undefined = event?.app_user_id;
  const type: string | undefined = event?.type;
  if (!userId || !type) {
    return new Response(JSON.stringify({ error: 'No event' }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now = new Date().toISOString();

  if (PRO_EVENTS.has(type)) {
    const expiresAt = event.expiration_at_ms
      ? new Date(Number(event.expiration_at_ms)).toISOString()
      : null;
    await supabase
      .from('profiles')
      .update({ subscription_tier: 'pro', subscription_expires_at: expiresAt, updated_at: now })
      .eq('id', userId);
  } else if (FREE_EVENTS.has(type)) {
    await supabase
      .from('profiles')
      .update({ subscription_tier: 'free', subscription_expires_at: null, updated_at: now })
      .eq('id', userId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
