/**
 * Shared Resend integration + branded HTML email templates.
 * Requires RESEND_API_KEY secret. Silently skips if not set.
 * From address: VegeTrack <hola@vegantrack.app> (must be verified in Resend).
 */

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'VegeTrack <hola@vegantrack.app>';
export const OWNER_EMAIL = 'transicionveg@gmail.com';

interface SendOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(opts: SendOptions): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.warn('[email] RESEND_API_KEY not set — skipping');
    return false;
  }
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    console.error('[email] Resend error', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background:#eef5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef5f0;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.09);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2f5d41 0%,#3a7a54 100%);padding:36px 48px;text-align:center;">
            <div style="color:#f3efe3;font-size:26px;font-weight:300;letter-spacing:-0.3px;">🌿 VegeTrack</div>
            <div style="color:rgba(255,255,255,0.6);font-size:12px;letter-spacing:1.2px;text-transform:uppercase;margin-top:5px;">Nutrición vegana inteligente</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:44px 48px 36px;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f5f8f6;border-top:1px solid #e4ede7;padding:22px 48px;text-align:center;">
            <p style="color:#8fa496;font-size:12px;margin:0 0 6px 0;">VegeTrack · Tu aliado en la nutrición vegana</p>
            <p style="color:#aab9af;font-size:11px;margin:0;">
              Si no esperabas este email, puedes ignorarlo con total seguridad.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export function buildSignupEmail(name?: string): { subject: string; html: string } {
  const first = name?.trim().split(' ')[0];
  const greeting = first ? `¡Hola, ${first}!` : '¡Bienvenido a VegeTrack!';

  return {
    subject: 'Tu cuenta está lista 🌿',
    html: layout(`
      <h1 style="color:#1a2e22;font-size:26px;font-weight:700;margin:0 0 14px 0;line-height:1.3;">${greeting}</h1>
      <p style="color:#4a5e52;font-size:15px;line-height:1.7;margin:0 0 28px 0;">
        Ya eres parte de VegeTrack. Tu cuenta está activa y lista para ayudarte a llevar una nutrición vegana equilibrada, con datos reales y sin adivinar.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
        ${[
          ['🥗', 'Diario nutricional', 'Registra cada comida con más de 1&nbsp;M de alimentos en la base de datos.'],
          ['📷', 'Análisis de platos con IA', 'Saca una foto y obtén macros y micros al instante.'],
          ['📊', 'Micros clave vigilados', 'Vitamina B12, D, hierro, calcio y omega-3 siempre a la vista.'],
          ['⚖️', 'Seguimiento de peso', 'Curva de progreso con tendencia semanal para ver tu evolución real.'],
        ].map(([icon, title, desc]) => `
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #f0f5f2;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:22px;padding-right:14px;vertical-align:top;padding-top:2px;">${icon}</td>
              <td>
                <div style="color:#1a2e22;font-weight:700;font-size:14px;">${title}</div>
                <div style="color:#6b7c72;font-size:13px;line-height:1.5;margin-top:2px;">${desc}</div>
              </td>
            </tr></table>
          </td>
        </tr>`).join('')}
      </table>

      <div style="background:#f0f9f3;border-radius:10px;padding:18px 20px;margin:0 0 32px 0;">
        <p style="color:#2f5d41;font-size:13px;font-weight:700;margin:0 0 4px 0;">📱 Próximo paso</p>
        <p style="color:#4a5e52;font-size:13px;line-height:1.6;margin:0;">
          Completa el onboarding en la app (tardas menos de 2&nbsp;min) para que calculemos tus objetivos de calorías y macros personalizados con la fórmula Mifflin-St&nbsp;Jeor.
        </p>
      </div>

      <div style="text-align:center;">
        <a href="https://vegantrack.app" style="display:inline-block;background:#2f5d41;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.2px;">Abrir VegeTrack →</a>
      </div>
    `),
  };
}

export function buildWelcomeEmail(params: {
  name?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}): { subject: string; html: string } {
  const first = params.name?.trim().split(' ')[0];
  const greeting = first ? `¡Todo listo, ${first}!` : '¡Tu plan está listo!';
  const subjectName = first ? `${first}, tu plan` : 'Tu plan';

  const macroRow = (params.protein_g && params.carbs_g && params.fat_g)
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
        <tr>
          ${[
            { label: 'Proteína', value: `${params.protein_g}g`, color: '#22c55e' },
            { label: 'Carbos', value: `${params.carbs_g}g`, color: '#f59e0b' },
            { label: 'Grasa', value: `${params.fat_g}g`, color: '#f97316' },
          ].map((m, i) => `
          <td style="width:33%;padding:${i === 1 ? '0 6px' : '0'};">
            <div style="background:#ffffff;border-radius:8px;border-left:3px solid ${m.color};padding:8px 10px;">
              <div style="color:#1a2e22;font-weight:800;font-size:15px;">${m.value}</div>
              <div style="color:#8fa496;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${m.label}</div>
            </div>
          </td>`).join('')}
        </tr>
      </table>`
    : '';

  const calorieBlock = params.calories
    ? `<div style="background:#f0f9f3;border:1.5px solid #2f5d41;border-radius:12px;padding:24px 20px;margin:24px 0;text-align:center;">
        <div style="color:#2f5d41;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px;">Tu objetivo diario</div>
        <div style="color:#1a2e22;font-size:52px;font-weight:800;line-height:1.1;">${params.calories.toLocaleString('es-ES')}</div>
        <div style="color:#4a5e52;font-size:14px;font-weight:600;margin-bottom:4px;">kcal / día</div>
        ${macroRow}
      </div>`
    : '';

  return {
    subject: `${subjectName} VegeTrack está listo 🌱`,
    html: layout(`
      <h1 style="color:#1a2e22;font-size:26px;font-weight:700;margin:0 0 12px 0;">${greeting}</h1>
      <p style="color:#4a5e52;font-size:15px;line-height:1.7;margin:0 0 4px 0;">
        Hemos calculado tu plan personalizado con la fórmula Mifflin-St Jeor. Estos son tus objetivos para hoy y cada día:
      </p>

      ${calorieBlock}

      <p style="color:#1a2e22;font-size:14px;font-weight:700;margin:20px 0 10px 0;">Ya puedes empezar a:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
        ${[
          ['🍽️', 'Registrar tu primera comida — escríbela, fótola o escanea el código de barras'],
          ['📊', 'Ver tu progreso en tiempo real en el panel de Resumen'],
          ['📷', 'Usar el análisis de IA para platos sin etiquetar'],
        ].map(([icon, text]) => `
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #f0f5f2;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:20px;padding-right:12px;vertical-align:middle;">${icon}</td>
              <td style="color:#4a5e52;font-size:13px;line-height:1.5;">${text}</td>
            </tr></table>
          </td>
        </tr>`).join('')}
      </table>

      <div style="background:#fef9ec;border:1px solid #fcd34d;border-radius:10px;padding:16px 18px;margin:0 0 28px 0;">
        <p style="color:#92400e;font-size:13px;font-weight:700;margin:0 0 3px 0;">👑 Prueba Pro gratis 7 días</p>
        <p style="color:#92400e;font-size:13px;line-height:1.5;margin:0;">
          Análisis de platos ilimitado, historial completo y tendencias de micros. Cancela cuando quieras, sin compromiso.
        </p>
      </div>

      <div style="text-align:center;">
        <a href="https://vegantrack.app" style="display:inline-block;background:#2f5d41;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px;">Ir a mi diario →</a>
      </div>
    `),
  };
}

/** Aviso interno para el dueño de la app (no va al usuario). Sin la capa de marca. */
export function buildOwnerAlertEmail(
  title: string,
  rows: Array<[string, string]>
): { subject: string; html: string } {
  const body = `
    <h2 style="color:#1a2e22;font-size:20px;margin:0 0 16px 0;">${title}</h2>
    <table cellpadding="0" cellspacing="0" width="100%">
      ${rows.map(([label, value]) => `
      <tr>
        <td style="padding:6px 0;color:#8fa496;font-size:13px;width:140px;vertical-align:top;">${label}</td>
        <td style="padding:6px 0;color:#1a2e22;font-size:13px;font-weight:600;">${value}</td>
      </tr>`).join('')}
    </table>
  `;
  return { subject: `VegeTrack — ${title}`, html: layout(body) };
}

export function buildFarewellEmail(name?: string): { subject: string; html: string } {
  const first = name?.trim().split(' ')[0];
  const greeting = first ? `Hasta pronto, ${first}` : 'Hasta pronto';

  return {
    subject: 'Tu cuenta de VegeTrack ha sido eliminada',
    html: layout(`
      <h1 style="color:#1a2e22;font-size:24px;font-weight:700;margin:0 0 16px 0;">${greeting}</h1>
      <p style="color:#4a5e52;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
        Hemos recibido tu solicitud y tu cuenta ha sido eliminada permanentemente. No recibirás más emails de nuestra parte.
      </p>

      <div style="background:#f5f8f6;border:1px solid #d4e2d9;border-radius:10px;padding:18px 20px;margin:0 0 20px 0;">
        <p style="color:#2f5d41;font-size:13px;font-weight:700;margin:0 0 8px 0;">✅ Datos eliminados permanentemente:</p>
        <table cellpadding="0" cellspacing="0">
          ${['Tu perfil y datos personales', 'Diario de comidas e historial', 'Registros de peso', 'Análisis de platos y recetas'].map(item => `
          <tr><td style="color:#4a5e52;font-size:13px;line-height:1.8;">· ${item}</td></tr>`).join('')}
        </table>
      </div>

      <p style="color:#4a5e52;font-size:14px;line-height:1.7;margin:0 0 28px 0;">
        Si en algún momento quieres volver, siempre puedes crear una cuenta nueva. La nutrición vegana estará aquí cuando la necesites. 🌱
      </p>

      <div style="text-align:center;">
        <a href="https://vegantrack.app" style="display:inline-block;background:#2f5d41;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">Volver a VegeTrack</a>
      </div>
    `),
  };
}
