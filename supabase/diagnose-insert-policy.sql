-- ═════════════════════════════════════════════════════════════════════════════
-- Diagnóstico: ¿existe un vector de INSERT sobre public.profiles?
--
-- Contexto: el repositorio (README.md, "Backend") documenta que el esquema de
-- Supabase pertenece a la PWA hermana, no a este repo. No hay ningún INSERT a
-- `profiles` en todo `src/`, y `authStore.signUp()` sólo llama a
-- `supabase.auth.signUp()` + `fetchProfile()` — nunca inserta la fila. Eso
-- significa que el mecanismo real de creación de perfiles no puede
-- determinarse leyendo este repositorio: sólo consultando la base de datos.
--
-- Este script es ÍNTEGRAMENTE de sólo lectura. Ninguna sentencia escribe,
-- bloquea ni modifica nada — no hace falta BEGIN/ROLLBACK porque no hay nada
-- que deshacer.
-- ═════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ I1 · ¿Tiene RLS habilitada la tabla, y es "forzada"?                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- relrowsecurity = RLS activa para roles normales.
-- relforcerowsecurity = RLS se aplica incluso al propietario de la tabla.
-- Si relrowsecurity = true y NO existe ninguna policy de INSERT (ver I2),
-- Postgres deniega TODO INSERT de cualquier rol no-superusuario por defecto:
-- RLS es "deny by default" por tipo de comando cuando no hay policy que lo cubra.
select relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public.profiles'::regclass;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ I2 · Policies que cubren INSERT (comando 'a') o ALL (comando '*')        ║
-- ║      — ES LA RESPUESTA DIRECTA A LAS PREGUNTAS 1 Y 2                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- 0 filas  → no existe ninguna vía de INSERT para ningún rol no-superusuario,
--            pase lo que pase con los privilegios de tabla (I3). Ni siquiera
--            hace falta mirar I3: RLS ya deniega todo.
-- >0 filas → mira with_check_expr: si no menciona subscription_tier ni
--            subscription_expires_at, un INSERT permitido por esa policy
--            podría dejarlas con cualquier valor que el cliente envíe.
select
  polname,
  case polcmd when 'a' then 'INSERT' when '*' then 'ALL' else polcmd::text end as comando,
  polpermissive                                              as permisiva,
  coalesce(
    (select string_agg(pg_get_userbyid(r), ', ') from unnest(polroles) r),
    'public')                                                as roles,
  pg_get_expr(polwithcheck, polrelid)                         as with_check_expr
from pg_policy
where polrelid = 'public.profiles'::regclass
  and polcmd in ('a', '*')
order by polname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ I3 · Privilegio de tabla INSERT (independiente de la RLS)                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Es habitual en Supabase que el grant de tabla sea amplio por defecto
-- (igual que descubrimos con UPDATE) y que la RLS sea la única barrera real.
-- Esta consulta por sí sola NO es decisiva: sólo lo es en combinación con I1/I2.
select grantee, privilege_type
from information_schema.table_privileges
where table_schema   = 'public'
  and table_name     = 'profiles'
  and privilege_type = 'INSERT'
  and grantee in ('anon', 'authenticated');


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ I4 · ¿Existe un trigger sobre auth.users que cree el perfil?             ║
-- ║      — RESPUESTA A LA PREGUNTA 4                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Patrón estándar de Supabase: un trigger AFTER INSERT sobre auth.users que
-- llama a una función SECURITY DEFINER (típicamente handle_new_user). Si
-- existe, la fila de profiles la crea ESA función, con sus propios valores
-- fijos — nunca un INSERT que el cliente controle o parametrice.
select
  t.tgname                                              as trigger_name,
  case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end as momento,
  concat_ws(' ',
    case when (t.tgtype & 4)  <> 0 then 'INSERT' end,
    case when (t.tgtype & 8)  <> 0 then 'DELETE' end,
    case when (t.tgtype & 16) <> 0 then 'UPDATE' end)     as eventos,
  p.proname                                               as funcion,
  p.prosecdef                                             as security_definer,
  pg_get_userbyid(p.proowner)                             as propietario_funcion
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'auth'
  and c.relname = 'users'
  and not t.tgisinternal
order by t.tgname;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ I5 · Código de esa función (si I4 devolvió algo)                        ║
-- ║      — RESPUESTA A LA PREGUNTA 5, Y A "¿controla el cliente el          ║
-- ║        subscription_tier de la fila creada?"                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Busca en el cuerpo si el INSERT fija subscription_tier a un valor fijo
-- (p.ej. 'free') o si de algún modo toma un valor de entrada del cliente
-- (raro, pero hay que comprobarlo, no darlo por hecho).
select t.tgname, pg_get_functiondef(p.oid) as definicion
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'auth'
  and c.relname = 'users'
  and not t.tgisinternal;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ I6 · Cualquier otra función SECURITY DEFINER que inserte en profiles     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Por si el mecanismo no es un trigger sobre auth.users sino una función que
-- la PWA invoca directamente (RPC) tras el signUp.
select
  n.nspname   as esquema,
  p.proname   as funcion,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as propietario
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and pg_get_functiondef(p.oid) ilike '%insert into%profiles%'
order by n.nspname, p.proname;


-- ═════════════════════════════════════════════════════════════════════════════
-- Cómo leer el resultado
--
--   Si I1=true y I2 devuelve 0 filas
--     → INSERT ya está cerrado para cualquier rol de cliente, sin depender de
--       I3 en absoluto. No hace falta ningún cambio.
--
--   Si I2 devuelve alguna policy para 'authenticated' con un with_check_expr
--   que NO menciona subscription_tier/subscription_expires_at, Y ADEMÁS I3
--   confirma que 'authenticated' tiene privilegio de tabla INSERT
--     → existe un vector real: un cliente podría insertar su propia fila (si
--       el with_check se lo permite, p.ej. `auth.uid() = id`) con
--       subscription_tier='pro'. Haría falta extender la protección a INSERT.
--
--   Si I4/I5 muestran un trigger SECURITY DEFINER sobre auth.users que fija
--   subscription_tier a un valor constante en su INSERT
--     → la creación real de perfiles no pasa nunca por un INSERT que el
--       cliente controle, sea cual sea la respuesta de I2/I3: ese código no
--       lee nada que el cliente le pueda enviar. INSERT es seguro por
--       construcción, independientemente de la policy.
-- ═════════════════════════════════════════════════════════════════════════════
