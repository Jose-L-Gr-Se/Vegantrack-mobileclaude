\o /dev/null
select t.eq('backfill 101: racha retrocedida → recalculada', t.state(101), '(0,6)');
select t.eq('backfill 102: sin entradas → (null,0)', t.state(102), '(null,0)');
select t.eq('backfill 103: ya coherente → no se toca (updated_at intacto)',
            (select updated_at::date::text from profiles where id = t.uid(103)), '2020-01-01');
select t.eq('backfill 103: mantiene (0,3)', t.state(103), '(0,3)');
select t.eq('backfill 104: sólo futuro lejano → (null,0)', t.state(104), '(null,0)');
select t.eq('backfill 105: streak_count nulo → (0,2)', t.state(105), '(0,2)');
select t.eq('backfill 106: cuenta días, no filas; hueco corta → (0,2)', t.state(106), '(0,2)');
select t.eq('backfill: todos coinciden con el oráculo',
            (select count(*) filter (where t.state(n) is distinct from t.oracle(n))::text from generate_series(101,106) n), '0');
insert into t.mem select 'u101_updated', updated_at::text from profiles where id = t.uid(101);
