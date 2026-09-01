-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación manual del blindaje de subscription_tier
--
-- Ejecutar en Supabase → SQL Editor DESPUÉS de aplicar
-- supabase/migrations/20260901000000_protect_subscription_columns.sql
--
-- Todos los bloques de simulación terminan en ROLLBACK: no modifican datos
-- reales. Sustituye <UUID_DE_PRUEBA> por el id de un perfil real de pruebas
-- (por ejemplo: select id from public.profiles limit 1).
-- ═════════════════════════════════════════════════════════════════════════════


-- ─── 0. Inventario: ¿qué columnas puede escribir cada rol? ───────────────────
-- Esperado: `authenticated` aparece con las 14 columnas de la allowlist y NO
-- con subscription_tier, subscription_expires_at ni stripe_customer_id.
-- `anon` no debe aparecer en absoluto.
select grantee, string_agg(column_name, ', ' order by column_name) as columnas_update
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee
order by grantee;


-- ─── 0b. ¿Queda algún UPDATE a nivel de TABLA para los roles de cliente? ─────
-- Esperado: 0 filas. Si aparece alguna, la capa 1 se ha perdido (alguien ha
-- vuelto a ejecutar `grant all ... to authenticated`) y sólo protege el trigger.
select grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated');


-- ─── 0c. ¿Está instalado el trigger? ─────────────────────────────────────────
-- Esperado: 1 fila, tgenabled = 'O' (habilitado).
select t.tgname, t.tgenabled, p.prosecdef as es_security_definer
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass
  and t.tgname = 'trg_profiles_entitlement_guard';
-- es_security_definer DEBE ser false: si fuese true, current_user sería el
-- propietario de la función y el guard no detectaría a ningún cliente.


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. ATAQUE: un usuario free intenta concederse Pro
--    Esperado: ERROR 42501 "permission denied for column subscription_tier"
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', '<UUID_DE_PRUEBA>', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  update public.profiles
     set subscription_tier = 'pro',
         subscription_expires_at = now() + interval '10 years'
   where id = '<UUID_DE_PRUEBA>';
rollback;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. NO REGRESIÓN: las actualizaciones normales de perfil siguen funcionando
--    Esperado: UPDATE 1, sin error.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', '<UUID_DE_PRUEBA>', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  update public.profiles
     set display_name   = 'Prueba guard',
         weight_kg      = 70,
         calorie_target = 2200,
         updated_at     = now()
   where id = '<UUID_DE_PRUEBA>';

  reset role;
  select display_name, weight_kg, calorie_target
    from public.profiles where id = '<UUID_DE_PRUEBA>';
rollback;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. LA CAPA 2 AGUANTA SOLA
--    Simula la regresión más probable (`grant all ... to authenticated`) y
--    comprueba que el trigger sigue protegiendo la columna.
--    Esperado: la sentencia NO falla, pero subscription_tier sigue siendo el
--    valor original, y el log muestra un WARNING.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  -- Regresión simulada (se deshace con el rollback del final)
  grant update on public.profiles to authenticated;

  select set_config(
    'request.jwt.claims',
    json_build_object('sub', '<UUID_DE_PRUEBA>', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  update public.profiles
     set subscription_tier = 'pro'
   where id = '<UUID_DE_PRUEBA>';

  reset role;
  select subscription_tier as debe_seguir_siendo_free
    from public.profiles where id = '<UUID_DE_PRUEBA>';
rollback;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. EL WEBHOOK SIGUE PUDIENDO ACTIVAR PRO
--    Esperado: subscription_tier = 'pro' dentro de la transacción.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  set local role service_role;

  update public.profiles
     set subscription_tier       = 'pro',
         subscription_expires_at = now() + interval '30 days',
         updated_at              = now()
   where id = '<UUID_DE_PRUEBA>';

  select subscription_tier, subscription_expires_at
    from public.profiles where id = '<UUID_DE_PRUEBA>';

  reset role;
rollback;


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. EL WEBHOOK SIGUE PUDIENDO DEGRADAR A FREE (evento EXPIRATION)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  set local role service_role;

  update public.profiles
     set subscription_tier       = 'free',
         subscription_expires_at = null,
         updated_at              = now()
   where id = '<UUID_DE_PRUEBA>';

  select subscription_tier, subscription_expires_at
    from public.profiles where id = '<UUID_DE_PRUEBA>';

  reset role;
rollback;
