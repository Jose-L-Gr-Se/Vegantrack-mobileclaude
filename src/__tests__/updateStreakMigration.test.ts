/**
 * Racha cronológica — propiedades de seguridad de la migración
 * 20260930000000_update_streak_chronological.sql, comprobadas sobre su texto
 * (Jest no ejecuta SQL). La semántica se verifica en ejecución con
 * `npm run test:sql` (supabase/tests/update_streak/), contra un Postgres
 * desechable: 14 escenarios, concurrencia real, idempotencia y guarda de
 * identidad.
 */
declare const __dirname: string;
declare const require: (id: string) => any;

const fs = require('fs') as { readFileSync(f: string, enc: 'utf8'): string; existsSync(f: string): boolean };
const path = require('path') as { join(...p: string[]): string };

const REPO = path.join(__dirname, '..', '..');
const MIGRATION = fs.readFileSync(
  path.join(REPO, 'supabase', 'migrations', '20260930000000_update_streak_chronological.sql'),
  'utf8'
);
const SQL_DIR = path.join(REPO, 'supabase', 'tests', 'update_streak');

const sinComentarios = MIGRATION.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

describe('20260930000000_update_streak_chronological.sql', () => {
  it('es transaccional: exactamente un begin y un commit, nunca un rollback', () => {
    expect((sinComentarios.match(/^begin;/gim) ?? []).length).toBe(1);
    expect((sinComentarios.match(/^commit;/gim) ?? []).length).toBe(1);
    expect(sinComentarios).not.toMatch(/^rollback;/im);
  });

  it('conserva la firma y la guarda de identidad (auth.uid() = p_user_id) al principio', () => {
    expect(sinComentarios).toContain('create or replace function public.update_streak(p_user_id uuid, p_date date)');
    expect(sinComentarios).toContain('security definer');
    expect(sinComentarios).toContain("set search_path to 'public'");
    expect(sinComentarios).toContain('auth.uid() is distinct from p_user_id');
    expect(sinComentarios.indexOf('auth.uid() is distinct from p_user_id')).toBeLessThan(
      sinComentarios.indexOf('for update')
    );
  });

  it('serializa por usuario con FOR UPDATE sobre su perfil, ANTES de leer food_log', () => {
    expect(sinComentarios).toMatch(/perform 1 from profiles where id = p_user_id for update/);
    expect(sinComentarios.indexOf('for update')).toBeLessThan(sinComentarios.indexOf('select max(date)'));
  });

  it('deriva la racha de food_log (recursivo, sin depender de p_date) y tolera current_date + 1', () => {
    expect(sinComentarios).toContain('with recursive run');
    expect(sinComentarios).toContain("(now() at time zone 'utc')::date + 1");
    // p_date sólo aparece en la firma: no interviene en el cálculo.
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf('as $function$'), sinComentarios.indexOf('$function$;'));
    expect(cuerpo).not.toContain('p_date');
  });

  it('la regla antigua ya no existe: nada de contador incremental ni de "ELSE v_streak := 1"', () => {
    expect(sinComentarios).not.toMatch(/else\s+v_streak\s*:=\s*1/i);
    expect(sinComentarios).not.toMatch(/v_streak\s*:=\s*v_streak\s*\+\s*1/i);
    expect(sinComentarios).not.toMatch(/v_last_date/);
  });

  it('sólo escribe si algo cambia (idempotente, sin reescribir updated_at en vano)', () => {
    expect(sinComentarios).toMatch(/streak_count is distinct from v_streak or last_log_date is distinct from v_last/);
  });

  it('alcance mínimo: sin trigger, sin tablas/columnas/índices nuevos, sin GRANT/REVOKE, sin borrados', () => {
    expect(sinComentarios).not.toMatch(/\bcreate\s+(or\s+replace\s+)?trigger\b/i);
    expect(sinComentarios).not.toMatch(/\bcreate\s+table\b/i);
    expect(sinComentarios).not.toMatch(/\balter\s+table\b/i);
    expect(sinComentarios).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i);
    expect(sinComentarios).not.toMatch(/\bgrant\b/i);
    expect(sinComentarios).not.toMatch(/\brevoke\b/i);
    expect(sinComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(sinComentarios).not.toMatch(/\btruncate\b/i);
    expect(sinComentarios).not.toMatch(/\bdrop\b/i);
  });

  it('el backfill es set-based, con el mismo tope de fecha, y sólo toca los perfiles que difieren', () => {
    const backfill = sinComentarios.slice(sinComentarios.indexOf('with capped as'));
    expect(backfill).toContain("date <= (now() at time zone 'utc')::date + 1");
    expect(backfill).toMatch(/update public\.profiles p/);
    expect(backfill).toMatch(/p\.streak_count is distinct from t\.streak or p\.last_log_date is distinct from t\.last_day/);
    // Un único UPDATE: nada de bucles fila a fila.
    expect((backfill.match(/\bupdate\b/gi) ?? []).length).toBe(1);
    expect(backfill).not.toMatch(/\bloop\b/i);
  });
});

describe('arnés SQL de update_streak (supabase/tests/update_streak)', () => {
  it('existen el runner y los ficheros de escenarios', () => {
    for (const f of ['run.sh', '00_stub.sql', '10_backfill_seed.sql', '20_backfill_assert.sql', '25_backfill_rerun_assert.sql', '30_scenarios.sql']) {
      expect(fs.existsSync(path.join(SQL_DIR, f))).toBe(true);
    }
  });

  it('cubre los 14 escenarios auditados, la concurrencia real, la idempotencia y la guarda de identidad', () => {
    const scenarios = fs.readFileSync(path.join(SQL_DIR, '30_scenarios.sql'), 'utf8');
    const runner = fs.readFileSync(path.join(SQL_DIR, 'run.sh'), 'utf8');
    for (const marker of ['01 ', '02 ', '03 ', '04a', '04f', '06 ', '07 ', '08 ', '09a', '10a', '10b', '11 ', '12a', '13a', '13b']) {
      expect(scenarios).toContain(`'${marker}`);
    }
    expect(runner).toContain('05 CONTROL sin FOR UPDATE');
    expect(runner).toContain('14 CON FOR UPDATE');
    // El oráculo es independiente de la función bajo prueba.
    expect(fs.readFileSync(path.join(SQL_DIR, '00_stub.sql'), 'utf8')).toContain('create function t.oracle');
  });
});
