\o /dev/null
select t.eq('backfill idempotente: reaplicar la migración no vuelve a escribir',
            (select updated_at::text from profiles where id = t.uid(101)), (select v from t.mem where k = 'u101_updated'));
select t.eq('backfill idempotente: 103 sigue intacto',
            (select updated_at::date::text from profiles where id = t.uid(103)), '2020-01-01');
