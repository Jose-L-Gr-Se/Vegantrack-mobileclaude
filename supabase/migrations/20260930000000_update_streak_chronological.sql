-- ═════════════════════════════════════════════════════════════════════════════
-- update_streak: racha CRONOLÓGICA derivada de food_log
-- ═════════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA (verificado ejecutando la función desplegada en un Postgres local)
--   `update_streak` era un contador incremental anclado a `last_log_date`:
--   mismo día no cambia, día siguiente suma 1 y CUALQUIER otra fecha ponía la
--   racha a 1 y movía `last_log_date` a esa fecha. Registrar, corregir o
--   copiar comida con fecha pasada destruía la racha (13 de 14 escenarios
--   auditados), el resultado dependía del ORDEN de llegada de las llamadas
--   (mismas dos entradas: (28,1) o (29,6)), y planificar una comida a más de
--   un día vista también la reiniciaba.
--
-- SEMÁNTICA (aprobada)
--   racha = nº de días naturales consecutivos con >=1 fila en food_log,
--   terminando en el último día válido (`last_log_date`).
--   - Depende SÓLO del conjunto de fechas, nunca del orden ni del momento de
--     las llamadas: es idempotente y conmutativa.
--   - Una fecha pasada cuenta como su día: puede unir tramos; nunca reduce ni
--     retrocede la racha (salvo que se BORRE el día — el cliente vuelve a
--     llamar tras borrar).
--   - Fechas > current_date(UTC) + 1 se ignoran. El +1 tolera usuarios cuya
--     fecha local va por delante de la del servidor.
--   - `p_date` se conserva por compatibilidad de firma (app móvil y PWA
--     llaman con (p_user_id, p_date)); ya no interviene en el cálculo.
--
-- CONCURRENCIA
--   El SELECT del perfil no estaba bloqueado (lectura-modificación-escritura
--   sin lock): dos llamadas solapadas podían dejar el estado de la más lenta.
--   `FOR UPDATE` sobre la fila del perfil serializa las llamadas de un mismo
--   usuario; cada una recalcula con una instantánea posterior al bloqueo.
--
-- ALCANCE (mínimo)
--   - Reemplaza el cuerpo de la función (misma firma, SECURITY DEFINER, misma
--     guarda `auth.uid() = p_user_id`). `create or replace` conserva los
--     privilegios de EXECUTE existentes.
--   - Sin trigger, sin tablas/columnas nuevas, sin índices nuevos: usa el
--     índice existente (user_id, date). El coste es proporcional a la
--     longitud de la racha (una sonda de índice por día).
--   - Backfill set-based al final: recalcula sólo los perfiles cuyo estado
--     actual difiere del derivado (los demás no se tocan).
--
-- ORDEN DE DESPLIEGUE
--   Aplicar ANTES de publicar la versión del cliente que llama a esta RPC
--   tras borrar/sincronizar: con la función antigua esas llamadas (fecha
--   pasada) reiniciarían la racha.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.update_streak(p_user_id uuid, p_date date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cap    date := (now() at time zone 'utc')::date + 1;
  v_last   date;
  v_streak integer := 0;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'update_streak: p_user_id must match the authenticated user';
  end if;

  perform 1 from profiles where id = p_user_id for update;

  select max(date) into v_last
  from food_log
  where user_id = p_user_id and date <= v_cap;

  if v_last is not null then
    with recursive run as (
      select v_last as d
      union all
      select d - 1 from run
      where exists (select 1 from food_log where user_id = p_user_id and date = run.d - 1)
    )
    select count(*) into v_streak from run;
  end if;

  update profiles
  set streak_count = v_streak,
      last_log_date = v_last,
      updated_at = now()
  where id = p_user_id
    and (streak_count is distinct from v_streak or last_log_date is distinct from v_last);

  return v_streak;
end;
$function$;

comment on function public.update_streak(uuid, date) is
  'Racha cronológica derivada de food_log: días naturales consecutivos con >=1 entrada, terminando en el último día válido (<= current_date UTC + 1). Idempotente e independiente del orden de las llamadas; FOR UPDATE serializa por usuario. SECURITY DEFINER: exige que p_user_id coincida con auth.uid(). p_date se conserva sólo por compatibilidad de firma.';

-- Backfill: deja los perfiles existentes con el valor derivado. Mismo criterio
-- que la función (mismo tope de fecha); sólo actualiza los que difieren.
with capped as (
  select distinct user_id, date
  from public.food_log
  where date <= (now() at time zone 'utc')::date + 1
),
last_day as (
  select user_id, max(date) as last_day from capped group by user_id
),
ranked as (
  select user_id, date + (row_number() over (partition by user_id order by date desc))::int as k
  from capped
),
calc as (
  select l.user_id, l.last_day, count(*)::int as streak
  from last_day l
  join ranked r on r.user_id = l.user_id and r.k = l.last_day + 1
  group by l.user_id, l.last_day
)
update public.profiles p
set streak_count = t.streak,
    last_log_date = t.last_day,
    updated_at = now()
from (
  select pr.id, coalesce(c.streak, 0) as streak, c.last_day
  from public.profiles pr
  left join calc c on c.user_id = pr.id
) t
where p.id = t.id
  and (p.streak_count is distinct from t.streak or p.last_log_date is distinct from t.last_day);

commit;
