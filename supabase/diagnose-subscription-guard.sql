-- ═════════════════════════════════════════════════════════════════════════════
-- Diagnóstico: ¿por qué no se aplica una escritura de service_role sobre
-- profiles.subscription_tier?
--
-- Contexto: verify-subscription-guard.sql devolvió 1-4 PASA y 5 FALLA. El
-- escenario 5 (service_role degrada 'pro' → 'free') dejó el valor en 'pro'.
--
-- Este script NO modifica nada: todo va dentro de transacciones que terminan en
-- ROLLBACK, y las partes D1-D6 son de sólo lectura.
--
-- Sustituye <UUID_DE_PRUEBA> por el mismo id que usaste en la verificación.
-- ═════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D1 · Identidad y GUCs de esta sesión del SQL Editor                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Importante: si `claims_jwt` NO está vacío y contiene "role":"authenticated",
-- el guard de la migración trataría a CUALQUIER escritor como cliente, incluido
-- service_role. Es una de las tres hipótesis.
select
  current_user                                        as usuario_efectivo,
  session_user                                        as usuario_de_sesion,
  current_setting('request.jwt.claims', true)         as claims_jwt,
  current_setting('role', true)                       as guc_role,
  current_setting('row_security', true)               as row_security;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D2 · TODOS los triggers de public.profiles                               ║
-- ║      (el orden de disparo es alfabético por nombre)                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Si aparece algún trigger BEFORE UPDATE además del nuestro, y su nombre va
-- DESPUÉS de 'trg_profiles_entitlement_guard' alfabéticamente, puede estar
-- sobrescribiendo lo que nosotros dejamos pasar.
select
  t.tgname                                            as trigger_name,
  case t.tgenabled when 'O' then 'habilitado'
                   when 'D' then 'DESHABILITADO'
                   else t.tgenabled::text end         as estado,
  case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end as momento,
  concat_ws(' ',
    case when (t.tgtype & 4)  <> 0 then 'INSERT' end,
    case when (t.tgtype & 8)  <> 0 then 'DELETE' end,
    case when (t.tgtype & 16) <> 0 then 'UPDATE' end)  as eventos,
  p.proname                                           as funcion,
  p.prosecdef                                         as security_definer,
  pg_get_userbyid(p.proowner)                         as propietario_funcion
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass
  and not t.tgisinternal
order by t.tgname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D3 · Código de TODAS las funciones de trigger de profiles                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Busca aquí cualquier otra función que toque subscription_tier.
select t.tgname, pg_get_functiondef(p.oid) as definicion
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass
  and not t.tgisinternal
order by t.tgname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D4 · Cualquier función del proyecto que mencione subscription_tier       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Incluye RPCs antiguas, jobs, funciones de "freemium limits", etc.
select
  n.nspname   as esquema,
  p.proname   as funcion,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as propietario
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and pg_get_functiondef(p.oid) ilike '%subscription_tier%'
order by n.nspname, p.proname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D5 · Atributos de rol: ¿service_role puede saltarse la RLS?              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Si service_role tuviera rolbypassrls = false, la policy `auth.uid() = id`
-- filtraría la fila (auth.uid() es NULL sin JWT) y el UPDATE afectaría a
-- 0 filas sin dar ningún error. Es la segunda hipótesis.
select rolname, rolbypassrls, rolsuper, rolcanlogin
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'postgres', 'authenticator')
order by rolname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D6 · Todas las policies de profiles (no sólo la de UPDATE)               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
select
  polname,
  case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
              when 'w' then 'UPDATE' when 'd' then 'DELETE'
              else 'ALL' end                              as comando,
  polpermissive                                           as permisiva,
  coalesce(
    (select string_agg(pg_get_userbyid(r), ', ') from unnest(polroles) r),
    'public')                                             as roles,
  pg_get_expr(polqual, polrelid)                          as using_expr,
  pg_get_expr(polwithcheck, polrelid)                     as with_check_expr
from pg_policy
where polrelid = 'public.profiles'::regclass
order by polname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D7 · EL EXPERIMENTO DECISIVO — ejecutar este bloque ENTERO               ║
-- ║                                                                          ║
-- ║ Distingue las tres hipótesis con datos, no con suposiciones:             ║
-- ║                                                                          ║
-- ║   filas_afectadas = 0  → la RLS filtró la fila. NO es un trigger.       ║
-- ║   filas = 1 y valor sin cambiar, con nuestro trigger ACTIVO,             ║
-- ║           pero SÍ cambia con nuestro trigger desactivado                 ║
-- ║                        → la causa es NUESTRO guard.                     ║
-- ║   filas = 1 y valor sin cambiar en AMBOS casos                           ║
-- ║                        → hay OTRO trigger revirtiéndolo (ver D2/D3).     ║
-- ║   filas = 1 y el valor cambia con el guard activo                        ║
-- ║                        → escribe bien; el fallo era del script anterior. ║
-- ║                                                                          ║
-- ║ Todo ocurre dentro de una transacción que termina en ROLLBACK. El        ║
-- ║ `disable trigger` es temporal y se deshace igual que el resto.           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

begin;

create or replace function pg_temp.vt_diagnostico(p_id uuid)
returns table (
  paso    text,
  detalle text
)
language plpgsql
as $fn$
declare
  v_ini      text;
  v_tras     text;
  v_filas    bigint;
  v_user     text;
  v_claims   text;
begin
  select p.subscription_tier into v_ini from public.profiles p where p.id = p_id;

  paso := '0 · estado inicial';
  detalle := format('subscription_tier = %L  ← si es ''pro'', el escenario 4 de la verificación pasaba en vacío', v_ini);
  return next;

  -- ── A · escritura como service_role, con NUESTRO trigger activo ──────────
  begin
    execute 'set local role service_role';
    v_user   := current_user::text;
    v_claims := coalesce(current_setting('request.jwt.claims', true), '(no definido)');

    update public.profiles
       set subscription_tier = case when v_ini = 'pro' then 'free' else 'pro' end
     where id = p_id;
    get diagnostics v_filas = row_count;

    select p.subscription_tier into v_tras from public.profiles p where p.id = p_id;
    execute 'reset role';

    paso := 'A · service_role escribe (guard ACTIVO)';
    detalle := format(
      'current_user en el momento del UPDATE = %L · claims = %s · filas_afectadas = %s · valor: %L → %L · %s',
      v_user, v_claims, v_filas, v_ini, v_tras,
      case
        when v_filas = 0 then '>>> 0 FILAS: la RLS filtró la fila. No es un trigger.'
        when v_tras is distinct from v_ini then '>>> ESCRIBE BIEN.'
        else '>>> 1 fila pero el valor NO cambió: un trigger BEFORE lo revirtió.'
      end);
    raise exception using errcode = 'VT002', message = 'fin';
  exception
    when sqlstate 'VT002' then null;
    when others then
      paso := 'A · service_role escribe (guard ACTIVO)';
      detalle := format('ERROR %s · %s', sqlstate, sqlerrm);
  end;
  return next;

  -- ── B · lo mismo, pero con NUESTRO trigger desactivado ───────────────────
  begin
    execute 'alter table public.profiles disable trigger trg_profiles_entitlement_guard';
    execute 'set local role service_role';

    update public.profiles
       set subscription_tier = case when v_ini = 'pro' then 'free' else 'pro' end
     where id = p_id;
    get diagnostics v_filas = row_count;

    select p.subscription_tier into v_tras from public.profiles p where p.id = p_id;
    execute 'reset role';

    paso := 'B · service_role escribe (NUESTRO guard DESACTIVADO)';
    detalle := format(
      'filas_afectadas = %s · valor: %L → %L · %s',
      v_filas, v_ini, v_tras,
      case
        when v_filas = 0 then '>>> 0 FILAS: es la RLS, no un trigger.'
        when v_tras is distinct from v_ini then '>>> AHORA SÍ ESCRIBE: la causa es NUESTRO guard.'
        else '>>> SIGUE SIN CAMBIAR: hay OTRO trigger. Míralo en D2/D3.'
      end);
    raise exception using errcode = 'VT002', message = 'fin';
  exception
    when sqlstate 'VT002' then null;
    when others then
      paso := 'B · service_role escribe (NUESTRO guard DESACTIVADO)';
      detalle := format('ERROR %s · %s', sqlstate, sqlerrm);
  end;
  return next;

  -- ── C · ¿qué vería exactamente el guard con service_role? ────────────────
  begin
    execute 'set local role service_role';
    paso := 'C · lo que evalúa el guard';
    detalle := format(
      'caller_role = %L · claim_role = %L · ¿deja pasar? = %s',
      current_user::text,
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
      case when current_user::text not in ('anon','authenticated')
            and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
                not in ('anon','authenticated')
           then 'SÍ (return new)' else 'NO (revierte)' end);
    execute 'reset role';
    raise exception using errcode = 'VT002', message = 'fin';
  exception
    when sqlstate 'VT002' then null;
    when others then
      paso := 'C · lo que evalúa el guard';
      detalle := format('ERROR %s · %s', sqlstate, sqlerrm);
  end;
  return next;
end;
$fn$;

select * from pg_temp.vt_diagnostico('<UUID_DE_PRUEBA>');

rollback;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D8 · Red de seguridad — ejecutar DESPUÉS de D7                           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- El trigger debe seguir habilitado ('O') y el perfil intacto.
select t.tgname, t.tgenabled
from pg_trigger t
where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
order by t.tgname;

select id, subscription_tier, subscription_expires_at, updated_at
from public.profiles where id = '<UUID_DE_PRUEBA>';


-- ═════════════════════════════════════════════════════════════════════════════
-- SEGUNDA RONDA — añadida tras ver los resultados de D2/D5/D7
--
-- D7 demostró que activar o desactivar trg_profiles_entitlement_guard no
-- cambia nada: service_role sigue sin poder escribir. El único sospechoso que
-- queda en pie es protect_subscription_fields_trigger, que NO está en este
-- repositorio y del que aún no tenemos el código (falta D3).
--
-- Estos dos bloques NO tocan protect_subscription_fields_trigger en absoluto
-- -ni lo deshabilitan, ni lo alteran-, sólo hacen variar el ROL y los CLAIMS
-- con los que se ejecuta el UPDATE, para acotar por qué distingue (si es que
-- lo hace) una llamada real del webhook de una llamada manual del SQL Editor.
-- Todo dentro de transacciones con ROLLBACK.
-- ═════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D9 · ¿Bloquea también free → pro, o sólo pro → free?                     ║
-- ║      (D7 sólo probó pro → free, porque el perfil ya partía de 'pro')     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

begin;

create or replace function pg_temp.vt_d9(p_id uuid)
returns table (paso text, detalle text)
language plpgsql
as $fn$
declare
  v_filas bigint;
  v_tras  text;
begin
  -- Línea base en 'free', igual que D7 la ponía en 'pro'.
  update public.profiles set subscription_tier = 'free' where id = p_id;

  begin
    execute 'set local role service_role';
    update public.profiles set subscription_tier = 'pro' where id = p_id;
    get diagnostics v_filas = row_count;
    select p.subscription_tier into v_tras from public.profiles p where p.id = p_id;
    execute 'reset role';
    paso := 'D9 · service_role escribe free → pro';
    detalle := format(
      'filas_afectadas = %s · valor final = %L · %s',
      v_filas, v_tras,
      case when v_tras = 'pro' then '>>> SÍ escribe: sólo bloquea pro → free'
           else '>>> NO escribe: bloquea en ambas direcciones' end);
    raise exception using errcode = 'VT003', message = 'fin';
  exception
    when sqlstate 'VT003' then null;
    when others then
      paso := 'D9 · service_role escribe free → pro';
      detalle := format('ERROR %s · %s', sqlstate, sqlerrm);
  end;
  return next;
end;
$fn$;

select * from pg_temp.vt_d9('<UUID_DE_PRUEBA>');

rollback;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ D10 · ¿Distingue protect_subscription_fields por current_user o por el   ║
-- ║       claim del JWT? Decisivo para saber si el webhook REAL falla igual. ║
-- ║                                                                          ║
-- ║ El SQL Editor, al hacer `set local role service_role`, cambia el rol     ║
-- ║ efectivo pero NO deja ningún request.jwt.claims (session_role queda      ║
-- ║ vacío). Una llamada real del webhook, en cambio, llega a través de       ║
-- ║ PostgREST con la service_role key, y PostgREST sí puede fijar            ║
-- ║ request.jwt.claims con {"role":"service_role", ...} antes del SET ROLE.  ║
-- ║                                                                          ║
-- ║ Si protect_subscription_fields decide mirando el CLAIM en vez de         ║
-- ║ current_user, este experimento lo demuestra: el mismo rol, con y sin ese ║
-- ║ claim puesto, da resultados distintos.                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

begin;

create or replace function pg_temp.vt_d10(p_id uuid)
returns table (paso text, detalle text)
language plpgsql
as $fn$
declare
  v_filas bigint;
  v_tras  text;
begin
  -- ── (a) service_role SIN ningún claim de JWT (como en D7) ────────────────
  update public.profiles set subscription_tier = 'pro' where id = p_id;
  begin
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role service_role';
    update public.profiles set subscription_tier = 'free' where id = p_id;
    get diagnostics v_filas = row_count;
    select p.subscription_tier into v_tras from public.profiles p where p.id = p_id;
    execute 'reset role';
    paso := 'D10a · service_role, SIN claims de JWT';
    detalle := format('filas = %s · valor final = %L · %s',
      v_filas, v_tras, case when v_tras = 'free' then '>>> escribe' else '>>> bloqueado' end);
    raise exception using errcode = 'VT004', message = 'fin';
  exception
    when sqlstate 'VT004' then null;
    when others then
      paso := 'D10a · service_role, SIN claims de JWT';
      detalle := format('ERROR %s · %s', sqlstate, sqlerrm);
  end;
  return next;

  -- ── (b) service_role CON el claim que pondría PostgREST de verdad ────────
  update public.profiles set subscription_tier = 'pro' where id = p_id;
  begin
    perform set_config(
      'request.jwt.claims',
      json_build_object('role', 'service_role', 'iss', 'supabase')::text,
      true
    );
    execute 'set local role service_role';
    update public.profiles set subscription_tier = 'free' where id = p_id;
    get diagnostics v_filas = row_count;
    select p.subscription_tier into v_tras from public.profiles p where p.id = p_id;
    execute 'reset role';
    paso := 'D10b · service_role, CON claim role=service_role';
    detalle := format('filas = %s · valor final = %L · %s',
      v_filas, v_tras, case when v_tras = 'free' then '>>> escribe' else '>>> bloqueado' end);
    raise exception using errcode = 'VT004', message = 'fin';
  exception
    when sqlstate 'VT004' then null;
    when others then
      paso := 'D10b · service_role, CON claim role=service_role';
      detalle := format('ERROR %s · %s', sqlstate, sqlerrm);
  end;
  return next;
end;
$fn$;

select * from pg_temp.vt_d10('<UUID_DE_PRUEBA>');

rollback;

-- Si D10a y D10b dan resultados DISTINTOS, protect_subscription_fields decide
-- por el claim del JWT, no por current_user, y hay que revisar en producción
-- si las llamadas reales de PostgREST con la service_role key sí incluyen ese
-- claim (los logs de la función revenuecat-webhook y la latencia/estado de
-- sus últimas invocaciones son la evidencia que lo confirma o lo descarta).
