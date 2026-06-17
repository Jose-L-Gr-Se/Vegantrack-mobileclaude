# Edge Function: analyze-meal

Backend de **VeganLens** (análisis de platos con IA). Vive en **Supabase**, no en
Vercel: la app móvil llama a `POST {SUPABASE_URL}/functions/v1/analyze-meal`.

La API key de Gemini vive sólo aquí como *secret*; nunca se incluye en la APK.

## Requisitos previos (una vez)

1. **Tablas** (si no existen ya): ejecuta `supabase/meal-scans-and-analytics.sql`
   en el SQL Editor de Supabase. Crea `meal_scans` y `analytics_events`.
2. **CLI de Supabase** instalada y proyecto enlazado:
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <TU_PROJECT_REF>
   ```

## Secrets

```bash
supabase secrets set GEMINI_API_KEY=<tu_api_key_de_gemini>
# Opcionales:
supabase secrets set GEMINI_MODEL=gemini-2.5-flash-lite
supabase secrets set FREE_DAILY_SCANS=3
```
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente
(no hay que añadirlos).

## Desplegar

```bash
supabase functions deploy analyze-meal
```
(La función exige JWT por defecto: la app envía el token del usuario, así que
funciona sin flags. No usar `--no-verify-jwt`.)

## Probar

```bash
# Debe responder 401 (sin token) — confirma que está desplegada y accesible.
curl -i -X POST "https://<TU_REF>.supabase.co/functions/v1/analyze-meal" \
  -H "apikey: <ANON_KEY>"
```

Desde la app: Diario → **Analizar plato con IA** → foto → reviso macros → guardar.

## Notas

- Modelo por defecto `gemini-2.5-flash-lite` (barato para imagen). Más precisión:
  `GEMINI_MODEL=gemini-2.5-flash`.
- Cuota: `FREE_DAILY_SCANS` (def. 3) por usuario/día para el plan free; Pro sin
  límite. La cuota se cuenta en `meal_scans`.
- Análisis general (no veganocéntrico): nunca rechaza un plato; la info vegana es
  opcional.
