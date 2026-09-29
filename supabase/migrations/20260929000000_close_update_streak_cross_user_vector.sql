-- ═════════════════════════════════════════════════════════════════════════════
-- Auditoría de aislamiento entre usuarios — cierra un vector de RPC
-- ═════════════════════════════════════════════════════════════════════════════
--
-- HALLAZGO (P0)
--   public.update_streak(p_user_id uuid, p_date date) es SECURITY DEFINER
--   (bypassa RLS) y usaba `p_user_id` directamente, sin comprobar NUNCA que
--   coincidiera con `auth.uid()`. Confirmado contra el proyecto real con
--   `pg_get_functiondef`: la función no contenía ninguna comprobación de
--   identidad, sólo el cuerpo de negocio (leer/actualizar la racha).
--
--   Cualquier usuario autenticado (el linter de seguridad de Supabase incluso
--   marca esta función como ejecutable por `anon`) podía llamar:
--
--     supabase.rpc('update_streak', { p_user_id: '<uuid-de-otra-cuenta>',
--                                      p_date: '2020-01-01' })
--
--   y sobrescribir `profiles.streak_count` / `profiles.last_log_date` de esa
--   otra cuenta — sin que RLS interviniera en ningún momento, porque
--   SECURITY DEFINER ejecuta como el propietario de la función, no como el
--   rol que hizo la llamada.
--
-- RIESGO REAL
--   Integridad de datos de un tercero: cualquier cuenta puede resetear o
--   inflar arbitrariamente la racha de cualquier otra cuenta, un dato que el
--   Diario y el VeganScore muestran como señal de comportamiento del propio
--   usuario.
--
-- FIX (mínimo, mismo patrón que enforce_profile_entitlement_guard())
--   Se añade una comprobación al principio de la función: si
--   `auth.uid() IS DISTINCT FROM p_user_id`, se lanza una excepción y no se
--   toca ninguna fila. El resto del cuerpo (la lógica de racha) no cambia ni
--   un carácter. Ningún llamador legítimo (móvil ni PWA) pasa nunca un
--   p_user_id distinto de su propia sesión, así que esto no cambia el
--   comportamiento para nadie salvo el vector de abuso.
--
-- VERIFICADO EN VIVO (proyecto real, antes de escribir este fichero)
--   Simulando auth.uid() = <uuid A> y llamando con p_user_id = <uuid B, real,
--   distinto de A>: ANTES del fix, la llamada habría escrito sobre el
--   perfil de B (no se ejecutó a propósito, para no tocar datos reales — la
--   lectura del código ya era inequívoca). DESPUÉS del fix, la misma llamada
--   lanza `P0001: update_streak: p_user_id must match the authenticated
--   user` sin tocar ninguna fila; una llamada con p_user_id = auth.uid()
--   sigue funcionando exactamente igual que antes.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.update_streak(p_user_id uuid, p_date date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_last_date date;
  v_streak integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'update_streak: p_user_id must match the authenticated user';
  END IF;

  SELECT last_log_date, COALESCE(streak_count, 0)
  INTO v_last_date, v_streak
  FROM profiles WHERE id = p_user_id;

  IF v_last_date IS NULL OR p_date > v_last_date + 1 THEN
    v_streak := 1;
  ELSIF p_date = v_last_date + 1 THEN
    v_streak := v_streak + 1;
  ELSIF p_date = v_last_date THEN
    RETURN v_streak;  -- Mismo día, no cambiar
  ELSE
    v_streak := 1;
  END IF;

  UPDATE profiles
  SET streak_count = v_streak,
      last_log_date = p_date,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN v_streak;
END;
$function$;

comment on function public.update_streak(uuid, date) is
  'Actualiza la racha de food_log. SECURITY DEFINER: exige que p_user_id coincida con auth.uid() (auditoría de aislamiento entre usuarios) — nunca confiar en p_user_id sin verificar.';
