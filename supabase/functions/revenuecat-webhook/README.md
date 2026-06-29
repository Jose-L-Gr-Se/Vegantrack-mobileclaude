# Edge Function: revenuecat-webhook

Sincroniza las suscripciones de **RevenueCat (Play Billing)** con la tabla
`profiles` de Supabase. Así el resto del backend (la cuota de IA en
`analyze-meal`, que lee `profiles.subscription_tier`) sabe quién es Pro.

## Cómo encaja

```
Usuario compra en la app (RevenueCat SDK / Play Billing)
      ↓
RevenueCat valida el recibo con Google
      ↓  (webhook)
ESTA función  →  UPDATE profiles SET subscription_tier='pro', subscription_expires_at=...
      ↓
La app y el backend ya ven al usuario como Pro
```

El `app_user_id` de RevenueCat **debe** ser el id de usuario de Supabase. La app
lo consigue llamando a `Purchases.logIn(supabaseUserId)` tras iniciar sesión.

## Configurar

1. **Secret** en Supabase (inventa un valor largo y aleatorio):
   ```bash
   supabase secrets set REVENUECAT_WEBHOOK_AUTH=<un_secreto_largo_aleatorio>
   ```
2. En **RevenueCat → Project settings → Integrations → Webhooks**:
   - URL: `https://<TU_REF>.supabase.co/functions/v1/revenuecat-webhook`
   - Authorization header: el MISMO valor de `REVENUECAT_WEBHOOK_AUTH`.

## Mapeo de eventos

| Evento RevenueCat | Acción |
|---|---|
| INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, UNCANCELLATION, SUBSCRIPTION_EXTENDED, NON_RENEWING_PURCHASE, TRANSFER | `tier=pro` + fecha de expiración |
| EXPIRATION | `tier=free` |
| CANCELLATION, BILLING_ISSUE | (sin cambio: sigue Pro hasta EXPIRATION) |

Desplegada con `verify_jwt=false` (RevenueCat usa su propio header Authorization,
no un JWT de Supabase); el secreto se valida dentro de la función.
