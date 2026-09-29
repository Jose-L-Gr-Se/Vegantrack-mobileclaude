-- Esquema mínimo + ayudas de prueba. No es el esquema de producción: sólo lo
-- que update_streak lee/escribe (profiles, food_log, auth.uid()).
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key, streak_count integer default 0, last_log_date date, updated_at timestamptz default now());
create table public.food_log (id uuid primary key default gen_random_uuid(), user_id uuid not null, date date not null);
create index food_log_user_date_idx on public.food_log (user_id, date);

-- La función DESPLEGADA antes de este cambio (misma definición que quedó registrada en su migración).
\i :repo/supabase/migrations/20260929000000_close_update_streak_cross_user_vector.sql

create schema t;
create table t.results (n serial, label text, ok boolean, got text, want text);
create table t.mem (k text primary key, v text);

create function t.today() returns date language sql stable as $$ select (now() at time zone 'utc')::date $$;
create function t.uid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function t.as_user(n int) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', t.uid(n)::text, false); end $$;

-- ORÁCULO independiente de la función bajo prueba: otro algoritmo (islas por
-- diferencia fila/fecha, set-based) sobre food_log, con el mismo tope de fecha.
create function t.oracle(n int) returns text language sql stable as $$
  with capped as (select distinct date from food_log where user_id = t.uid(n) and date <= t.today() + 1),
       lastd  as (select max(date) as d from capped),
       ranked as (select date + (row_number() over (order by date desc))::int as k from capped)
  select format('(%s,%s)', coalesce((select d - t.today() from lastd)::text, 'null'),
                (select count(*) from ranked, lastd where k = lastd.d + 1)) $$;

create function t.state(n int) returns text language sql stable as $$
  select format('(%s,%s)', coalesce((last_log_date - t.today())::text, 'null'), streak_count)
  from profiles where id = t.uid(n) $$;

create function t.eq(label text, got text, want text) returns void language plpgsql as $$
begin insert into t.results(label, ok, got, want) values (label, got is not distinct from want, got, want); end $$;

-- Comprueba el estado literal esperado Y que coincide con el oráculo.
create function t.check(label text, n int, want text) returns void language plpgsql as $$
begin
  perform t.eq(label, t.state(n), want);
  perform t.eq(label || ' · coincide con el oráculo', t.state(n), t.oracle(n));
end $$;

-- Estado inicial coherente (calculado por el ORÁCULO, no por la función bajo prueba).
create function t.setup(n int, offsets int[]) returns void language plpgsql as $$
declare x int;
begin
  perform t.as_user(n);
  delete from food_log where user_id = t.uid(n);
  delete from profiles where id = t.uid(n);
  foreach x in array offsets loop insert into food_log(user_id, date) values (t.uid(n), t.today() + x); end loop;
  insert into profiles(id, streak_count, last_log_date, updated_at)
  select t.uid(n),
         (regexp_match(t.oracle(n), ',(\d+)\)'))[1]::int,
         (select max(date) from food_log where user_id = t.uid(n) and date <= t.today() + 1),
         '2020-01-01'::timestamptz;
end $$;

create function t.log(n int, off int) returns void language plpgsql as $$
begin
  perform t.as_user(n);
  insert into food_log(user_id, date) values (t.uid(n), t.today() + off);
  perform public.update_streak(t.uid(n), t.today() + off);
end $$;

create function t.del(n int, off int) returns void language plpgsql as $$
begin
  perform t.as_user(n);
  delete from food_log where user_id = t.uid(n) and date = t.today() + off;
  perform public.update_streak(t.uid(n), t.today() + off);
end $$;

create function t.del_one(n int, off int) returns void language plpgsql as $$
begin
  perform t.as_user(n);
  delete from food_log where ctid in (select ctid from food_log where user_id = t.uid(n) and date = t.today() + off limit 1);
  perform public.update_streak(t.uid(n), t.today() + off);
end $$;

create function t.raises(q text) returns text language plpgsql as $$
begin execute q; return 'no error'; exception when others then return 'raised'; end $$;
