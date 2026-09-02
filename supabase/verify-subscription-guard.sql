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


-- ═════════════════════════════════════════════════════════════════════════════
-- A6-A10 · Verificación del cierre del vector de INSERT
-- (supabase/migrations/20260901000003_close_insert_vector.sql)
-- ═════════════════════════════════════════════════════════════════════════════

-- A6. RLS sigue habilitada en profiles (esta migración no la toca).
-- Esperado: relrowsecurity = true.
select relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public.profiles'::regclass;


-- A7. Ya no debe quedar ninguna policy de INSERT/ALL para roles de cliente.
-- Esperado: 0 filas. Si aparece "Users can insert own profile" (o cualquier
-- otra), la migración 000003 no se ha aplicado o no se aplicó del todo.
select polname, polcmd, pg_get_expr(polwithcheck, polrelid) as with_check_expr
from pg_policy
where polrelid = 'public.profiles'::regclass
  and polcmd in ('a', '*');


-- A8. anon/authenticated ya no tienen privilegio de tabla INSERT.
-- Esperado: 0 filas.
select grantee, privilege_type
from information_schema.table_privileges
where table_schema   = 'public'
  and table_name     = 'profiles'
  and privilege_type = 'INSERT'
  and grantee in ('anon', 'authenticated');


-- A9. handle_new_user() sigue existiendo, SECURITY DEFINER, disparado por
-- on_auth_user_created — la vía legítima de creación de perfiles no se toca.
-- Esperado: 1 fila, security_definer = true.
select
  t.tgname                                as trigger_name,
  p.proname                               as funcion,
  p.prosecdef                             as security_definer,
  pg_get_userbyid(p.proowner)             as propietario_funcion
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'auth'
  and c.relname = 'users'
  and not t.tgisinternal;


-- A10. La premisa que hace segura la revocación: postgres (propietario de
-- handle_new_user, I4) es superusuario o propietario de profiles, así que
-- REVOKE/RLS no le afectan cuando la función se ejecuta con sus privilegios.
-- Esperado: es_superusuario = true, o en su defecto es_propietario_profiles = true.
-- Si AMBAS salen false, no des por sentado que handle_new_user seguirá
-- pudiendo insertar — dilo aquí antes de aplicar nada más.
select
  r.rolname,
  r.rolsuper                                                    as es_superusuario,
  (c.relowner = r.oid)                                          as es_propietario_profiles
from pg_roles r
cross join pg_class c
where r.rolname = 'postgres'
  and c.oid = 'public.profiles'::regclass;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE B · Veredicto — ejecutar este bloque ENTERO de una vez              ║
-- ║           (selecciónalo y pulsa Run). Devuelve una tabla de 9 filas.      ║
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
  v_new_id   uuid;
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

  -- ── 8 ─ authenticated intenta insertar directamente su propio perfil ──────
  --        Vector confirmado por diagnose-insert-policy.sql: privilegio de
  --        tabla + policy permisiva permitían INSERT ... VALUES (auth.uid(),
  --        'pro'). Usa un id nuevo (gen_random_uuid()) para que el intento no
  --        dependa de si el perfil de pruebas ya existe: debe fallar por
  --        privilegios ANTES de llegar a comprobar ninguna fila.
  begin
    v_new_id := gen_random_uuid();
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_new_id::text, 'role', 'authenticated')::text,
      true
    );
    execute 'set local role authenticated';

    insert into public.profiles (id, subscription_tier, subscription_expires_at)
    values (v_new_id, 'pro', now() + interval '10 years');

    execute 'reset role';
    v_ok  := false;
    v_obs := 'el INSERT se ejecutó sin error: el vector sigue abierto';
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when insufficient_privilege then
      v_ok  := true;
      v_obs := format('bloqueado por privilegios · SQLSTATE 42501 · %s', sqlerrm);
    when others then
      v_ok  := false;
      v_obs := format('error inesperado (no es un rechazo de privilegios) %s · %s', sqlstate, sqlerrm);
  end;
  n := 8;
  escenario := 'authenticated intenta INSERT directo de su propio perfil (id nuevo)';
  esperado  := 'la sentencia falla con 42501: sin privilegio de tabla INSERT';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 9 ─ No queda ninguna policy de INSERT/ALL para roles de cliente ───────
  begin
    v_ok := not exists (
      select 1 from pg_policy
      where polrelid = 'public.profiles'::regclass
        and polcmd in ('a', '*')
    );
    v_obs := case when v_ok
      then 'ninguna policy cubre INSERT/ALL: coherente con el privilegio revocado'
      else 'SIGUE EXISTIENDO una policy de INSERT/ALL — código muerto o el vector no se cerró del todo' end;
  end;
  n := 9;
  escenario := 'no queda ninguna policy de INSERT/ALL apuntando a profiles';
  esperado  := '"Users can insert own profile" fue retirada';
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

-- C3. Confirma que el escenario 8 no dejó ningún perfil fantasma. El id era
-- aleatorio y todo el bloque B termina en ROLLBACK, así que esto debe dar
-- siempre 0 — es una comprobación de cinturón y tirantes, no se espera que
-- falle nunca.
select count(*) as perfiles_creados_ultimo_minuto
from public.profiles
where created_at > now() - interval '1 minute';


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ APÉNDICE · Los ataques en crudo                                          ║
-- ║ Ejecútalos sólo si quieres leer el mensaje original de Postgres.         ║
-- ║ IGNORA el HINT del editor sugiriendo GRANT: es el agujero que se cierra. ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- UPDATE — mensaje esperado: ERROR 42501: permission denied for table profiles
-- begin;
--   select set_config(
--     'request.jwt.claims',
--     json_build_object('sub', '<UUID_DE_PRUEBA>', 'role', 'authenticated')::text,
--     true
--   );
--   set local role authenticated;
--   update public.profiles set subscription_tier = 'pro' where id = '<UUID_DE_PRUEBA>';
-- rollback;

-- INSERT — mismo mensaje esperado, misma causa: sin privilegio de tabla.
-- El id es el mismo en el claim y en el INSERT a propósito (para que, si
-- alguna vez se ejecuta esto ANTES de aplicar la migración 000003, el fallo
-- que se vea sea el de privilegios y no un efecto lateral de que auth.uid()
-- no coincida con la fila que se intenta crear).
-- begin;
--   select set_config(
--     'request.jwt.claims',
--     json_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
--     true
--   );
--   set local role authenticated;
--   insert into public.profiles (id, subscription_tier)
--   values ('00000000-0000-0000-0000-000000000001'::uuid, 'pro');
-- rollback;
