-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación del blindaje de subscription_tier
--
-- Ejecutar en Supabase → SQL Editor DESPUÉS de aplicar
-- supabase/migrations/20260901000000_protect_subscription_columns.sql
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
-- POR QUÉ ESTE SCRIPT NO ES UNA LISTA DE UPDATEs SUELTOS
--
-- El escenario 1 (el ataque) DEBE terminar en error 42501. El SQL Editor de
-- Supabase aborta el script entero en el primer error, así que una versión
-- lineal nunca llegaba a ejecutar los escenarios 2-5: parecía un script roto
-- cuando en realidad la defensa estaba funcionando.
--
-- Aquí cada escenario corre dentro de su propia subtransacción con manejador
-- de excepciones, de modo que el error esperado se captura, se convierte en un
-- veredicto y el script continúa. Una sola ejecución devuelve una tabla con
-- las cinco pruebas.
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
-- Esperado como mínimo: trg_profiles_entitlement_guard, habilitado ('O') y con
-- es_security_definer = false. Si fuese true, `current_user` dentro de la
-- función sería el propietario y el guard no detectaría a ningún cliente.
--
-- IMPORTANTE: esta consulta NO filtra por nombre a propósito. Cualquier otro
-- trigger BEFORE UPDATE sobre profiles cuyo nombre vaya después del nuestro
-- alfabéticamente se ejecuta DESPUÉS y puede sobrescribir lo que dejamos pasar.
-- Filtrar por nombre nos habría ocultado justo esa clase de conflicto.
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


-- A4. La RLS sigue exactamente como estaba (no la hemos tocado).
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.profiles'::regclass
order by polname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ PARTE B · Veredicto — ejecutar este bloque ENTERO de una vez              ║
-- ║           (selecciónalo y pulsa Run). Devuelve una tabla de 5 filas.      ║
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
  v_claims   text;
  v_tier_ini text;
  v_tier_fin text;
  v_name_fin text;
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
  v_claims := json_build_object('sub', p_id::text, 'role', 'authenticated')::text;

  -- ── 1 ─ Un usuario autenticado intenta concederse Pro ─────────────────────
  begin
    perform set_config('request.jwt.claims', v_claims, true);
    execute 'set local role authenticated';

    update public.profiles
       set subscription_tier       = 'pro',
           subscription_expires_at = now() + interval '10 years'
     where id = p_id;

    -- Si llegamos aquí, el privilegio NO ha bloqueado la sentencia.
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
    perform set_config('request.jwt.claims', v_claims, true);
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
  --        `grant all on all tables in schema public to authenticated` es
  --        idiomático en Supabase y desharía la capa 1 sin dar ningún error.
  --        El GRANT vive sólo dentro de esta subtransacción, que SIEMPRE
  --        aborta (por VT001 o por excepción).
  begin
    execute 'grant update on public.profiles to authenticated';

    perform set_config('request.jwt.claims', v_claims, true);
    execute 'set local role authenticated';

    update public.profiles
       set subscription_tier = 'pro'
     where id = p_id;

    execute 'reset role';
    select p.subscription_tier into v_tier_fin from public.profiles p where p.id = p_id;
    v_ok  := (v_tier_fin is not distinct from v_tier_ini);
    v_obs := format(
      'con UPDATE de tabla concedido la sentencia no falla, pero el trigger revirtió el valor: subscription_tier = %L (era %L)',
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
  esperado  := 'la capa 2 (trigger) revierte el valor: subscription_tier no cambia';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 4 ─ El webhook activa Pro ─────────────────────────────────────────────
  --        Comprueba una TRANSICIÓN OBSERVADA (free → pro), no el estado final.
  --        Una versión anterior de este script sólo miraba si el valor final
  --        era 'pro': pasaba en vacío cuando el perfil YA era 'pro', aunque el
  --        UPDATE no hubiera hecho nada. Un test que aprueba sin que ocurra
  --        nada es un test roto.
  begin
    execute 'set local role service_role';

    -- Paso 1: línea base en 'free'.
    update public.profiles set subscription_tier = 'free' where id = p_id;
    get diagnostics v_filas1 = row_count;
    select p.subscription_tier into v_paso1 from public.profiles p where p.id = p_id;

    -- Paso 2: activar Pro.
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
      'filas afectadas %s y %s · valor: %L → (paso 1) %L → (paso 2) %L · %s',
      v_filas1, v_filas2, v_tier_ini, v_paso1, v_tier_fin,
      case
        when v_filas1 = 0 or v_filas2 = 0
          then '>>> 0 FILAS AFECTADAS: la RLS está filtrando la fila para service_role'
        when v_paso1 is not distinct from v_tier_ini and v_tier_fin is not distinct from v_tier_ini
          then '>>> ningún cambio se aplicó: un trigger BEFORE está revirtiendo las escrituras'
        when v_ok then '>>> transición observada correctamente'
        else '>>> transición incompleta'
      end);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when others then
      v_ok  := false;
      v_obs := format('el webhook NO puede activar Pro: %s · %s', sqlstate, sqlerrm);
  end;
  n := 4;
  escenario := 'service_role activa Pro (evento INITIAL_PURCHASE / RENEWAL)';
  esperado  := 'transición observada free → pro';
  observado := v_obs;
  veredicto := case when v_ok then 'PASA' else 'FALLA' end;
  return next;

  -- ── 5 ─ El webhook degrada a free ─────────────────────────────────────────
  --        Misma disciplina: transición observada pro → free.
  begin
    execute 'set local role service_role';

    -- Paso 1: línea base en 'pro'.
    update public.profiles set subscription_tier = 'pro' where id = p_id;
    get diagnostics v_filas1 = row_count;
    select p.subscription_tier into v_paso1 from public.profiles p where p.id = p_id;

    -- Paso 2: degradar (evento EXPIRATION).
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
      'filas afectadas %s y %s · valor: %L → (paso 1) %L → (paso 2) %L · %s',
      v_filas1, v_filas2, v_tier_ini, v_paso1, v_tier_fin,
      case
        when v_filas1 = 0 or v_filas2 = 0
          then '>>> 0 FILAS AFECTADAS: la RLS está filtrando la fila para service_role'
        when v_tier_fin is not distinct from v_paso1 and v_paso1 is not distinct from v_tier_ini
          then '>>> ningún cambio se aplicó: un trigger BEFORE está revirtiendo las escrituras'
        when v_ok then '>>> transición observada correctamente'
        else '>>> transición incompleta · ejecuta supabase/diagnose-subscription-guard.sql'
      end);
    raise exception using errcode = 'VT001', message = 'fin del escenario';
  exception
    when sqlstate 'VT001' then null;
    when others then
      v_ok  := false;
      v_obs := format('el webhook NO puede degradar a free: %s · %s', sqlstate, sqlerrm);
  end;
  n := 5;
  escenario := 'service_role degrada a free (evento EXPIRATION)';
  esperado  := 'transición observada pro → free';
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

-- C1. Confirma que el GRANT temporal del escenario 3 no ha sobrevivido.
-- Esperado: 0 filas. Si devuelve algo, ejecuta:
--   revoke update on public.profiles from authenticated;
--   -- y vuelve a aplicar el grant de columnas de la migración
select grantee, privilege_type
from information_schema.table_privileges
where table_schema   = 'public'
  and table_name     = 'profiles'
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated');

-- C2. Confirma que los datos del perfil de prueba están intactos.
select id, display_name, subscription_tier, subscription_expires_at, updated_at
from public.profiles
where id = '<UUID_DE_PRUEBA>';


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ APÉNDICE · El ataque en crudo                                            ║
-- ║                                                                          ║
-- ║ Este bloque SÍ termina en error: es exactamente lo que queremos ver.     ║
-- ║ Ejecútalo sólo si quieres leer el mensaje original de Postgres.          ║
-- ║                                                                          ║
-- ║ Mensaje esperado:                                                        ║
-- ║   ERROR: 42501: permission denied for table profiles                     ║
-- ║                                                                          ║
-- ║ Postgres informa de los fallos de privilegio de columna en DML a nivel   ║
-- ║ de TABLA, no de columna: el ejecutor lanza el error con el nombre de la  ║
-- ║ relación. Que diga "table" no significa que falte el UPDATE de tabla por ║
-- ║ error — significa que falta el privilegio sobre alguna columna que la    ║
-- ║ sentencia intenta escribir. Compruébalo cambiando subscription_tier por  ║
-- ║ display_name: esa versión funciona.                                      ║
-- ║                                                                          ║
-- ║ IGNORA el HINT del editor de Supabase                                    ║
-- ║ ("GRANT UPDATE ON public.profiles TO authenticated"): ese grant es       ║
-- ║ justamente el agujero que cierra la capa 1.                              ║
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
