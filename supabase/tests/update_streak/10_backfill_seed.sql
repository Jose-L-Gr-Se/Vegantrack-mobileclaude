-- Perfiles con estado divergente ANTES de aplicar la migración (el estado que
-- dejó el contador incremental). Se siembran directamente, sin llamar a la función.
\o /dev/null
select set_config('request.jwt.claim.sub', '', false);
-- 101: racha real de 6 días (T-5..T) pero el perfil retrocedió por una fecha pasada.
insert into food_log(user_id, date) select t.uid(101), t.today() + x from generate_series(-5, 0) x;
insert into profiles(id, streak_count, last_log_date, updated_at) values (t.uid(101), 1, t.today() - 20, '2020-01-01');
-- 102: sin ninguna entrada (las borró) pero conserva una racha.
insert into profiles(id, streak_count, last_log_date, updated_at) values (t.uid(102), 3, t.today() - 3, '2020-01-01');
-- 103: ya coherente: no debe tocarse (updated_at intacto).
insert into food_log(user_id, date) select t.uid(103), t.today() + x from generate_series(-2, 0) x;
insert into profiles(id, streak_count, last_log_date, updated_at) values (t.uid(103), 3, t.today(), '2020-01-01');
-- 104: sólo entradas en el futuro lejano: ninguna cuenta.
insert into food_log(user_id, date) values (t.uid(104), t.today() + 5);
insert into profiles(id, streak_count, last_log_date, updated_at) values (t.uid(104), 1, t.today() + 5, '2020-01-01');
-- 105: streak_count nulo con entradas.
insert into food_log(user_id, date) select t.uid(105), t.today() + x from generate_series(-1, 0) x;
insert into profiles(id, streak_count, last_log_date, updated_at) values (t.uid(105), null, null, '2020-01-01');
-- 106: entrada duplicada el mismo día + hueco: cuenta días, no filas.
insert into food_log(user_id, date) select t.uid(106), t.today() + x from unnest(array[0, 0, 0, -1, -3]) x;
insert into profiles(id, streak_count, last_log_date, updated_at) values (t.uid(106), 9, t.today() - 9, '2020-01-01');
