-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación del blindaje de subscription_tier — ARQUITECTURA CONSOLIDADA
--
-- Ejecutar en Supabase → SQL Editor DESPUÉS de aplicar
-- supabase/migrations/20260901000001_consolidate_subscription_guard.sql
-- (que a su vez requiere 20260901000000_protect_subscription_columns.sql).
--
-- Arquitectura verificada por este script (ver docs/SEGURIDAD-SUSCRIPCION.md):
--   Capa 1 — privilegios por columna: authenticated/anon sin UPDATE sobre
--            subscription_tier / subscription_expires_at / stripe_customer_id.
--   Capa 2 — protect_subscription_fields_trigger (ÚNICA autoridad; se retiró
--            trg_profiles_entitlement_guard, redundante).
--
-- NO concede ningún permiso de forma permanente y NO modifica ningún dato.
-- La única concesión que aparece (escenario 3) vive dentro de una
-- subtransacción que SIEMPRE aborta, dentro de una transacción que además
-- termina en ROLLBACK. La parte C lo comprueba después.
--
-- Sustituye <UUID_DE_PRUEBA> por el id de un perfil real
-- (select id from public.profiles limit 1).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ LOS ESCENARIOS DE service_role FIJAN EL CLAIM DEL JWT
--
-- protect_subscription_fields decide con auth.role(), que lee
-- request.jwt.claims. Un `set local role service_role` desnudo (sin fijar ese
-- claim) NO reproduce una llamada real: PostgREST, al decodificar la
-- service_role key, SÍ deja ese claim (confirmado con datos, no supuesto — ver
-- diagnose-subscription-guard.sql D10). Los escenarios 4 y 5 fijan el claim
-- explícitamente para probar el camino real, no un artefacto del SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE A · Inventario de configuración (sólo lectura, se puede ejecutar    ║
-- ║           entera sin riesgo)                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- A1. ¿Qué columnas puede escribir cada rol?
-- Esperado: `authenticated` con las 14 columnas de la allowlist y SIN
-- subscription_tier, subscription_expires_at ni stripe_customer_id.
-- `anon` no debe aparecer.
select
  grantee,
  count(*) as n_columnas,
  string_agg(column_name, ', ' order by column_name) as columnas_update
from information_schema.column_privileges
where table_schema   = 'public'
  and table_name     = 'profiles'
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee
order by grantee;


-- A2. ¿Queda algún UPDATE a nivel de TABLA para los roles de cliente?
-- Esperado: 0 filas. Si aparece alguna, la capa 1 se ha perdido (alguien ha
-- ejecutado `grant all ... to authenticated`) y sólo protege el trigger.
select grantee, privilege_type
from information_schema.table_privileges
where table_schema   = 'public'
  and table_name     = 'profiles'
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated');


-- A3. TODOS los triggers de profiles, en su orden real de disparo (alfabético).
-- Esperado tras la consolidación: EXACTAMENTE UNO gobernando el entitlement —
-- protect_subscription_fields_trigger, habilitado ('O'). Si aparece TAMBIÉN
-- trg_profiles_entitlement_guard, la migración de consolidación no se aplicó
-- (o no se aplicó del todo): son dos autoridades otra vez, el problema que
-- esta consolidación existe para cerrar.
--
-- IMPORTANTE: esta consulta NO filtra por nombre a propósito. Cualquier otro
-- trigger BEFORE UPDATE sobre profiles cuyo nombre vaya antes o después del
-- nuestro alfabéticamente se ejecuta en ese orden y puede interactuar con él.
select
  t.tgname                                            as trigger_name,
  case t.tgenabled when 'O' then 'habilitado'
                   when 'D' then 'DESHABILITADO'
                   else t.tgenabled::text end         as estado,
  case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end as momento,
  concat_ws(' ',
    case when (t.tgtype & 4)  <> 0 then 'INSERT' end,
    case when (t.tgtype & 8)  <> 0 then 'DELETE' end,
    case when (t.tgtype & 16) <> 0 then 'UPDATE' end) as eventos,
  p.proname                                           as funcion,
  p.prosecdef                                         as es_security_definer
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass
  and not t.tgisinternal
order by t.tgname;


-- A3b. Verificación específica: no debe quedar rastro del mecanismo retirado.
-- Esperado: 0 filas en ambas.
select tgname from pg_trigger
where tgrelid = 'public.profiles'::regclass
  and tgname = 'trg_profiles_entitlement_guard';

select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'enforce_profile_entitlement_guard';


-- A4. La RLS sigue exactamente como estaba (no la hemos tocado).
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.profiles'::regclass
order by polname;


-- A5. protect_subscription_fields protege ahora también stripe_customer_id.
-- Esperado: el texto de la definición menciona las tres columnas.
select
  pg_get_functiondef(p.oid) ilike '%subscription_tier%'      as protege_tier,
  pg_get_functiondef(p.oid) ilike '%subscription_expires_at%' as protege_expires,
  pg_get_functiondef(p.oid) ilike '%stripe_customer_id%'      as protege_stripe
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname = 'protect_subscription_fields';


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE B · Veredicto — ejecutar este bloque ENTERO de una vez              ║
-- ║           (selecciónalo y pulsa Run). Devuelve una tabla de 7 filas.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

begin;

create or replace function pg_temp.vt_verificar_guard(p_id uuid)
returns table (
  n         int,
  escenario text,
  esperado  text,
  observado text,
  veredicto text
)
language plpgsql
as $fn$
declare
  v_claims_auth    text;
  v_claims_service text;
  v_tier_ini text;
  v_tier_fin text;
  v_name_fin text;
  v_stripe_fin text;
  v_obs      text;
  v_ok       boolean;
  v_paso1    text;
  v_filas1   bigint;
  v_filas2   bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = p_id) then
    raise exception 'No existe ningún perfil con id %. Usa: select id from public.profiles limit 1;', p_id;
  end if;

  select p.subscription_tier into v_tier_ini from public.profiles p where p.id = p_id;
  v_claims_auth    := json_build_object('sub', p_id::text, 'role', 'authenticated')::text;
  -- Réplica del claim real que PostgREST fija para la service_role key.
  v_claims_service := json_build_object('role', 'service_role', 'iss', 'supabase')::text;

  -- ── 1 ─ Un usuario autenticado intenta concederse Pro ─────────────────────
  begin
    perform set_config('request.jwt.claims', v_claims_auth, true);
    execute 'set local role authenticated';

    update public.profiles
       set subscription_tier       = 'pro',
           subscription_expires_at = now() + interval '10 years'
     where id = p_id;

    execute 'reset role';
    select p.subscription_tier into v_tier_fin from public.profiles p where p.id = p_id;
    v_ok  := (v_tier_fin is not distinct from v_tier_ini);
    v_obs := format(
      'la sentencia no dio error; subscription_tier quedó en %L (era %L) → sólo protegió el trigger',
      v_tier_fin, v_tier_ini);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when insufficient_privilege then
      v_ok  := true;
      v_obs := format('bloqueado por privilegios · SQLSTATE 42501 · %s', sqlerrm);
    when others then
      v_ok  := false;
      v_obs := format('error inesperado %s · %s', sqlstate, sqlerrm);
  end;
  n := 1;
  escenario := 'authenticated intenta poner subscription_tier = pro';
  esperado  := 'la sentencia falla con 42501 (capa 1: privilegios por columna)';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 2 ─ No regresión: actualización legítima de perfil ────────────────────
  begin
    perform set_config('request.jwt.claims', v_claims_auth, true);
    execute 'set local role authenticated';

    update public.profiles
       set display_name   = '__verificacion_guard__',
           weight_kg      = 70,
           calorie_target = 2200,
           updated_at     = now()
     where id = p_id;

    execute 'reset role';
    select p.display_name into v_name_fin from public.profiles p where p.id = p_id;
    v_ok  := (v_name_fin = '__verificacion_guard__');
    v_obs := format('la actualización se aplicó; display_name quedó en %L', v_name_fin);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when others then
      v_ok  := false;
      v_obs := format('la app se ha roto: %s · %s', sqlstate, sqlerrm);
  end;
  n := 2;
  escenario := 'authenticated actualiza columnas legítimas del perfil';
  esperado  := 'funciona con normalidad (no hemos roto la app)';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 3 ─ Regresión simulada: alguien restaura el UPDATE de tabla ───────────
  --        Con la arquitectura consolidada, la única red que queda es
  --        protect_subscription_fields_trigger. Este escenario demuestra que
  --        aguanta sola.
  begin
    execute 'grant update on public.profiles to authenticated';

    perform set_config('request.jwt.claims', v_claims_auth, true);
    execute 'set local role authenticated';

    update public.profiles
       set subscription_tier = 'pro'
     where id = p_id;

    execute 'reset role';
    select p.subscription_tier into v_tier_fin from public.profiles p where p.id = p_id;
    v_ok  := (v_tier_fin is not distinct from v_tier_ini);
    v_obs := format(
      'con UPDATE de tabla concedido la sentencia no falla, pero protect_subscription_fields_trigger revirtió el valor: subscription_tier = %L (era %L)',
      v_tier_fin, v_tier_ini);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when others then
      v_ok  := false;
      v_obs := format('error inesperado %s · %s', sqlstate, sqlerrm);
  end;
  n := 3;
  escenario := 'con el UPDATE de tabla reconcedido por accidente, authenticated lo reintenta';
  esperado  := 'protect_subscription_fields_trigger revierte el valor solo, sin la capa 1';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 4 ─ El webhook activa Pro (free → pro), con el claim real ─────────────
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', v_claims_service, true);

    update public.profiles set subscription_tier = 'free', subscription_expires_at = null where id = p_id;
    get diagnostics v_filas1 = row_count;
    select p.subscription_tier into v_paso1 from public.profiles p where p.id = p_id;

    update public.profiles
       set subscription_tier       = 'pro',
           subscription_expires_at = now() + interval '30 days',
           updated_at              = now()
     where id = p_id;
    get diagnostics v_filas2 = row_count;
    select p.subscription_tier into v_tier_fin from public.profiles p where p.id = p_id;

    execute 'reset role';
    v_ok  := (v_paso1 = 'free' and v_tier_fin = 'pro');
    v_obs := format(
      'filas afectadas %s y %s · valor: (paso 1) %L → (paso 2) %L · %s',
      v_filas1, v_filas2, v_paso1, v_tier_fin,
      case when v_filas1 = 0 or v_filas2 = 0 then '>>> 0 FILAS AFECTADAS: revisar RLS/service_role'
           when v_ok then '>>> transición observada correctamente'
           else '>>> transición incompleta' end);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when others then
      v_ok  := false;
      v_obs := format('el webhook NO puede activar Pro: %s · %s', sqlstate, sqlerrm);
  end;
  n := 4;
  escenario := 'service_role activa Pro (evento INITIAL_PURCHASE / RENEWAL), claim real';
  esperado  := 'transición observada free → pro';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 5 ─ El webhook degrada a free (pro → free), con el claim real ─────────
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', v_claims_service, true);

    update public.profiles set subscription_tier = 'pro' where id = p_id;
    get diagnostics v_filas1 = row_count;
    select p.subscription_tier into v_paso1 from public.profiles p where p.id = p_id;

    update public.profiles
       set subscription_tier       = 'free',
           subscription_expires_at = null,
           updated_at              = now()
     where id = p_id;
    get diagnostics v_filas2 = row_count;
    select p.subscription_tier into v_tier_fin from public.profiles p where p.id = p_id;

    execute 'reset role';
    v_ok  := (v_paso1 = 'pro' and v_tier_fin = 'free');
    v_obs := format(
      'filas afectadas %s y %s · valor: (paso 1) %L → (paso 2) %L · %s',
      v_filas1, v_filas2, v_paso1, v_tier_fin,
      case when v_filas1 = 0 or v_filas2 = 0 then '>>> 0 FILAS AFECTADAS: revisar RLS/service_role'
           when v_ok then '>>> transición observada correctamente'
           else '>>> transición incompleta' end);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when others then
      v_ok  := false;
      v_obs := format('el webhook NO puede degradar a free: %s · %s', sqlstate, sqlerrm);
  end;
  n := 5;
  escenario := 'service_role degrada a free (evento EXPIRATION), claim real';
  esperado  := 'transición observada pro → free';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 6 ─ stripe_customer_id queda protegido (el hueco que cerró esta       ─
  --        consolidación: protect_subscription_fields original no lo cubría)
  begin
    perform set_config('request.jwt.claims', v_claims_auth, true);
    execute 'grant update (stripe_customer_id) on public.profiles to authenticated';
    execute 'set local role authenticated';

    update public.profiles set stripe_customer_id = 'cus_hackeado' where id = p_id;

    execute 'reset role';
    select p.stripe_customer_id into v_stripe_fin from public.profiles p where p.id = p_id;
    v_ok  := (v_stripe_fin is distinct from 'cus_hackeado');
    v_obs := format('stripe_customer_id quedó en %L tras el intento', v_stripe_fin);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when insufficient_privilege then
      v_ok  := true;
      v_obs := format('bloqueado por privilegios · SQLSTATE 42501 · %s', sqlerrm);
    when others then
      v_ok  := false;
      v_obs := format('error inesperado %s · %s', sqlstate, sqlerrm);
  end;
  n := 6;
  escenario := 'authenticated intenta escribir stripe_customer_id';
  esperado  := 'bloqueado (por privilegios o por protect_subscription_fields_trigger)';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 7 ─ Sólo queda UNA autoridad de entitlement ────────────────────────────
  begin
    v_ok := not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.profiles'::regclass
        and tgname = 'trg_profiles_entitlement_guard'
    );
    v_obs := case when v_ok
      then 'trg_profiles_entitlement_guard no existe: consolidación completa'
      else 'trg_profiles_entitlement_guard SIGUE EXISTIENDO: quedan dos autoridades' end;
  end;
  n := 7;
  escenario := 'no quedan dos triggers gobernando el entitlement';
  esperado  := 'trg_profiles_entitlement_guard fue retirado';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;
end;
$fn$;

select * from pg_temp.vt_verificar_guard('<UUID_DE_PRUEBA>') order by n;

rollback;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE C · Red de seguridad — ejecutar DESPUÉS de la parte B               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- C1. Confirma que los GRANTs temporales de los escenarios 3 y 6 no sobrevivieron.
-- Esperado: 0 filas.
select grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'profiles'
  and privilege_type = 'UPDATE' and grantee in ('anon', 'authenticated');

select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and column_name = 'stripe_customer_id' and grantee = 'authenticated';

-- C2. Confirma que los datos del perfil de prueba están intactos.
select id, display_name, subscription_tier, subscription_expires_at, stripe_customer_id, updated_at
from public.profiles
where id = '<UUID_DE_PRUEBA>';


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ APÉNDICE · El ataque en crudo                                            ║
-- ║ Ejecútalo sólo si quieres leer el mensaje original de Postgres.          ║
-- ║ Mensaje esperado: ERROR 42501: permission denied for table profiles      ║
-- ║ IGNORA el HINT del editor ("GRANT UPDATE ... TO authenticated").         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- begin;
--   select set_config(
--     'request.jwt.claims',
--     json_build_object('sub', '<UUID_DE_PRUEBA>', 'role', 'authenticated')::text,
--     true
--   );
--   set local role authenticated;
--   update public.profiles set subscription_tier = 'pro' where id = '<UUID_DE_PRUEBA>';
-- rollback;
