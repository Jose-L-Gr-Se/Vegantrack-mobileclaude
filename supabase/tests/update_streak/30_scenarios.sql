-- Escenarios auditados. Fechas relativas a hoy (T = current_date UTC): (-1,5) = último día ayer, racha 5.
-- Cada `select` es su propia transacción (como las llamadas reales del cliente).
\o /dev/null

-- 01 · registrar hoy
select t.setup(1, array[-5,-4,-3,-2,-1]);
select t.log(1, 0);
select t.check('01 registrar hoy', 1, '(0,6)');

-- 02 · ayer después de hoy
select t.setup(2, array[-5,-4,-3,-2,-1,0]);
select t.log(2, -1);
select t.check('02 ayer tras hoy (día ya registrado): no retrocede ni reduce', 2, '(0,6)');
select t.setup(3, array[-4,-3,-2,0]);
select t.log(3, -1);
select t.check('02b ayer tras hoy (día en blanco): une tramos', 3, '(0,5)');

-- 03 · hueco rellenado
select t.setup(4, array[-5,-4,-2,-1,0]);
select t.log(4, -3);
select t.check('03 hueco intermedio rellenado une los tramos', 4, '(0,6)');

-- 04 · varias fechas pasadas, ambos órdenes
select t.setup(5, array[-5,-4,-3,-2,-1,0]);
select t.log(5, -9); select t.log(5, -8); select t.log(5, -7);
select t.check('04a varias fechas pasadas (asc) con hueco: no cambia', 5, '(0,6)');
select t.setup(6, array[-5,-4,-3,-2,-1,0]);
select t.log(6, -7); select t.log(6, -8); select t.log(6, -9);
select t.check('04b varias fechas pasadas (desc) con hueco: no cambia', 6, '(0,6)');
select t.eq('04c el orden asc/desc produce EXACTAMENTE el mismo estado', t.state(5), t.state(6));
select t.log(5, -6); select t.log(6, -6);
select t.check('04d al cerrar el hueco, (asc) une todo', 5, '(0,10)');
select t.check('04e al cerrar el hueco, (desc) une todo', 6, '(0,10)');

-- 04f · el resultado depende sólo del conjunto: las 24 permutaciones de 4 llegadas dan lo mismo
do $$
declare r record; states text[] := '{}';
begin
  for r in
    select a.x a, b.x b, c.x c, d.x d
    from unnest(array[-1,-2,-3,-5]) a(x), unnest(array[-1,-2,-3,-5]) b(x),
         unnest(array[-1,-2,-3,-5]) c(x), unnest(array[-1,-2,-3,-5]) d(x)
    where a.x<>b.x and a.x<>c.x and a.x<>d.x and b.x<>c.x and b.x<>d.x and c.x<>d.x
  loop
    perform t.setup(7, array[0]);
    perform t.log(7, r.a); perform t.log(7, r.b); perform t.log(7, r.c); perform t.log(7, r.d);
    states := states || t.state(7);
  end loop;
  perform t.eq('04f 24 permutaciones de llegada → un único estado', (select count(distinct s)::text from unnest(states) s), '1');
  perform t.eq('04g ese estado es (0,4) (días 0..-3 contiguos; -5 aislado)', states[1], '(0,4)');
end $$;

-- 05/14 (concurrencia real) → se ejecutan en run.sh con dos sesiones.

-- 06 · fecha anterior a toda la racha
select t.setup(8, array[-5,-4,-3,-2,-1,0]);
select t.log(8, -30);
select t.check('06 fecha anterior a toda la racha: no la modifica', 8, '(0,6)');

-- 07 · mañana (tolerancia +1)
select t.setup(9, array[-5,-4,-3,-2,-1,0]);
select t.log(9, 1);
select t.check('07 mañana (current_date+1) se tolera y cuenta', 9, '(1,7)');

-- 08 · varios días futuros (> +1) se ignoran
select t.setup(10, array[-5,-4,-3,-2,-1,0]);
select t.log(10, 2); select t.log(10, 3); select t.log(10, 5);
select t.check('08 varios días futuros (>+1) se ignoran', 10, '(0,6)');
select t.setup(24, array[5,6]);
select t.check('08b sólo entradas futuras lejanas → sin racha', 24, '(null,0)');

-- 09 · registrar después de haber hecho un caso de fecha pasada
select t.setup(11, array[-5,-4,-3,-2,-1]);
select t.log(11, -20);
select t.check('09a tras una fecha pasada el estado sigue intacto', 11, '(-1,5)');
select t.log(11, 0);
select t.check('09b el siguiente día real continúa la racha (antes: 1)', 11, '(0,6)');

-- 10 · mismo día repetido: idempotente y sin escritura
select t.setup(12, array[-5,-4,-3,-2,-1,0]);
select t.log(12, 0);
select t.log(12, 0);
select t.check('10a mismo día repetido: estado idéntico', 12, '(0,6)');
select t.eq('10b mismo día repetido: NO reescribe el perfil (updated_at intacto)',
            (select updated_at::date::text from profiles where id = t.uid(12)), '2020-01-01');
select t.as_user(12);
select t.eq('10c la función devuelve la racha', public.update_streak(t.uid(12), t.today())::text, '6');
select t.eq('10d llamada repetida sin cambios: mismo retorno', public.update_streak(t.uid(12), t.today())::text, '6');

-- 11 · borrado del último día
select t.setup(13, array[-5,-4,-3,-2,-1,0]);
select t.del(13, 0);
select t.check('11 borrar la única entrada del último día recalcula', 13, '(-1,5)');

-- 12 · borrar día intermedio / una de dos entradas
select t.setup(14, array[-5,-4,-3,-2,-1,0]);
select t.del(14, -2);
select t.check('12a borrar un día intermedio corta la racha', 14, '(0,2)');
select t.setup(15, array[-5,-4,-3,-2,-1,-1,0]);
select t.del_one(15, -1);
select t.check('12b borrar UNA de dos entradas del mismo día no cambia nada', 15, '(0,6)');

-- 13 · usuario ajeno / anónimo
select t.setup(16, array[-5,-4,-3,-2,-1,0]);
select t.as_user(17);
select t.eq('13a llamar por OTRO usuario lanza excepción',
            t.raises(format('select public.update_streak(%L, %L)', t.uid(16), t.today())), 'raised');
select set_config('request.jwt.claim.sub', '', false);
select t.eq('13b sin sesión (anon) lanza excepción',
            t.raises(format('select public.update_streak(%L, %L)', t.uid(16), t.today())), 'raised');
select t.check('13c el perfil ajeno no cambia', 16, '(0,6)');
select t.eq('13d sigue siendo SECURITY DEFINER', (select prosecdef::text from pg_proc where proname = 'update_streak'), 'true');

-- extras
select t.setup(19, array[]::int[]);
select t.as_user(19);
select public.update_streak(t.uid(19), t.today());
select t.check('E1 usuario sin entradas → (null,0)', 19, '(null,0)');
select t.setup(18, (select array_agg(-x) from generate_series(0, 399) x));
select t.log(18, 1);
select t.check('E2 racha larga (400 días + mañana)', 18, '(1,401)');

-- resumen
\o
\pset tuples_only on
\pset format unaligned
select format('%s %s%s', case when ok then 'ok  ' else 'FAIL' end, label,
              case when ok then '' else format('   [obtenido %s · esperado %s]', got, want) end)
from t.results order by n;
select format('RESUMEN: %s comprobaciones, %s fallos', count(*), count(*) filter (where not ok)) from t.results;
