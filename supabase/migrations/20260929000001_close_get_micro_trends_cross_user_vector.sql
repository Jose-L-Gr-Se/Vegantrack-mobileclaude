-- ═════════════════════════════════════════════════════════════════════════════
-- Auditoría de aislamiento entre usuarios — cierra un vector de RPC
-- ═════════════════════════════════════════════════════════════════════════════
--
-- HALLAZGO (P0)
--   public.get_micro_trends(p_user_id uuid, p_weeks integer) es SECURITY
--   DEFINER (bypassa RLS de food_log/supplement_logs/supplements) y usaba
--   `p_user_id` directamente, sin comprobar NUNCA que coincidiera con
--   `auth.uid()`. Confirmado contra el proyecto real con
--   `pg_get_functiondef`: no había ninguna comprobación de identidad.
--
--   Cualquier usuario autenticado podía llamar:
--
--     supabase.rpc('get_micro_trends', { p_user_id: '<uuid-de-otra-cuenta>',
--                                         p_weeks: 12 })
--
--   y recibir las medias semanales de micronutrientes (comida + suplemento:
--   B12, hierro, zinc, calcio, vitamina D, omega-3) de esa otra cuenta —
--   datos de salud/nutrición de un tercero, sin que RLS interviniera.
--
-- RIESGO REAL
--   Confidencialidad de datos de salud de un tercero (lectura arbitraria de
--   cualquier cuenta por cualquier cuenta autenticada).
--
-- VERIFICADO EN VIVO (proyecto real, sólo lectura, sin modificar nada)
--   Simulando auth.uid() = un uuid arbitrario NO correspondiente al dueño de
--   los datos, y llamando con p_user_id = el id real de un perfil existente:
--   la función devolvió 8 semanas con datos reales (2 de ellas con valores
--   de nutrientes distintos de cero) de ESE OTRO usuario. Después del fix,
--   la misma llamada lanza `P0001: get_micro_trends: p_user_id must match
--   the authenticated user` y no devuelve ninguna fila; una llamada con
--   p_user_id = auth.uid() sigue devolviendo exactamente el mismo resultado
--   que antes (verificado: 8 semanas devueltas en ambos casos).
--
-- FIX (mínimo)
--   Se convierte la función de `language sql` a `language plpgsql`
--   ÚNICAMENTE para poder añadir el guard al principio (mismo patrón que
--   update_streak / enforce_profile_entitlement_guard()) — la consulta
--   interna no cambia ni un carácter salvo cualificar con el alias `fl` las
--   columnas de `food_log` dentro de la CTE `food_data` (ver nota más abajo).
--
-- NOTA — bug introducido y corregido en el propio proceso de esta auditoría
--   La primera versión de este fix (misma lógica, sin el alias `fl`) fallaba
--   con `42702 column reference "vitamin_b12_mcg" is ambiguous`: al pasar a
--   `plpgsql`, los nombres de `RETURNS TABLE(...)` (p. ej. `vitamin_b12_mcg`)
--   se convierten en variables de salida dentro del espacio de nombres de la
--   función, y colisionaban con las columnas homónimas de `food_log` leídas
--   sin cualificar dentro de `food_data`. Se detectó de inmediato al probar
--   el guard con una llamada legítima (antes de dar el fix por bueno) y se
--   corrigió cualificando `food_log` con el alias `fl` en esa CTE — la única
--   diferencia real de este fichero frente al cuerpo original de la función.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.get_micro_trends(p_user_id uuid, p_weeks integer default 8)
returns table(week_start date, vitamin_b12_mcg numeric, iron_mg numeric, zinc_mg numeric, calcium_mg numeric, vitamin_d_mcg numeric, omega3_g numeric, b12_from_supp numeric, iron_from_supp numeric, zinc_from_supp numeric, calcium_from_supp numeric, vitd_from_supp numeric, omega3_from_supp numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'get_micro_trends: p_user_id must match the authenticated user';
  END IF;

  RETURN QUERY
  WITH weeks AS (
    SELECT
      date_trunc('week', gs)::date AS week_start
    FROM generate_series(
      date_trunc('week', now()) - ((p_weeks - 1) * interval '1 week'),
      date_trunc('week', now()),
      interval '1 week'
    ) gs
  ),
  food_data AS (
    SELECT
      date_trunc('week', fl.date::timestamp)::date AS week_start,
      AVG(CASE WHEN fl.vitamin_b12_known THEN fl.vitamin_b12_mcg ELSE NULL END) AS vitamin_b12_mcg,
      AVG(CASE WHEN fl.iron_known        THEN fl.iron_mg         ELSE NULL END) AS iron_mg,
      AVG(CASE WHEN fl.zinc_known        THEN fl.zinc_mg         ELSE NULL END) AS zinc_mg,
      AVG(CASE WHEN fl.calcium_known     THEN fl.calcium_mg      ELSE NULL END) AS calcium_mg,
      AVG(CASE WHEN fl.vitamin_d_known   THEN fl.vitamin_d_mcg   ELSE NULL END) AS vitamin_d_mcg,
      AVG(CASE WHEN fl.omega3_known      THEN fl.omega3_g        ELSE NULL END) AS omega3_g
    FROM food_log fl
    WHERE fl.user_id = p_user_id
      AND fl.date >= (current_date - (p_weeks * 7))
    GROUP BY 1
  ),
  supp_data AS (
    SELECT
      date_trunc('week', sl.date::timestamp)::date AS week_start,
      SUM(CASE WHEN s.nutrient_key = 'vitamin_b12_mcg' THEN s.dose_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT sl.date), 0) AS b12_from_supp,
      SUM(CASE WHEN s.nutrient_key = 'iron_mg'         THEN s.dose_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT sl.date), 0) AS iron_from_supp,
      SUM(CASE WHEN s.nutrient_key = 'zinc_mg'         THEN s.dose_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT sl.date), 0) AS zinc_from_supp,
      SUM(CASE WHEN s.nutrient_key = 'calcium_mg'      THEN s.dose_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT sl.date), 0) AS calcium_from_supp,
      SUM(CASE WHEN s.nutrient_key = 'vitamin_d_mcg'   THEN s.dose_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT sl.date), 0) AS vitd_from_supp,
      SUM(CASE WHEN s.nutrient_key = 'omega3_g'        THEN s.dose_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT sl.date), 0) AS omega3_from_supp
    FROM supplement_logs sl
    JOIN supplements s ON s.id = sl.supplement_id
    WHERE sl.user_id = p_user_id
      AND sl.date >= (current_date - (p_weeks * 7))
    GROUP BY 1
  )
  SELECT
    w.week_start,
    COALESCE(f.vitamin_b12_mcg, 0)::numeric,
    COALESCE(f.iron_mg,         0)::numeric,
    COALESCE(f.zinc_mg,         0)::numeric,
    COALESCE(f.calcium_mg,      0)::numeric,
    COALESCE(f.vitamin_d_mcg,   0)::numeric,
    COALESCE(f.omega3_g,        0)::numeric,
    COALESCE(sd.b12_from_supp,    0)::numeric,
    COALESCE(sd.iron_from_supp,   0)::numeric,
    COALESCE(sd.zinc_from_supp,   0)::numeric,
    COALESCE(sd.calcium_from_supp,0)::numeric,
    COALESCE(sd.vitd_from_supp,   0)::numeric,
    COALESCE(sd.omega3_from_supp, 0)::numeric
  FROM weeks w
  LEFT JOIN food_data f  ON f.week_start  = w.week_start
  LEFT JOIN supp_data sd ON sd.week_start = w.week_start
  ORDER BY w.week_start ASC;
END;
$function$;

comment on function public.get_micro_trends(uuid, integer) is
  'Medias semanales de micronutrientes (comida+suplemento). SECURITY DEFINER: exige que p_user_id coincida con auth.uid() (auditoría de aislamiento entre usuarios) — nunca confiar en p_user_id sin verificar.';
