/**
 * Guardia del script de verificación SQL.
 *
 * No ejecuta SQL: comprueba que supabase/verify-subscription-guard.sql no
 * vuelva a tener los dos defectos que lo hicieron dar un veredicto engañoso
 * (1-4 PASA / 5 FALLA sobre un perfil que ya era 'pro'):
 *
 *   1. Los escenarios de service_role comprobaban el ESTADO FINAL
 *      (`v_tier_fin = 'pro'`) en vez de una TRANSICIÓN OBSERVADA. Sobre un
 *      perfil que ya estaba en 'pro', el escenario 4 aprobaba sin que el
 *      UPDATE hubiera hecho nada. Un test que aprueba sin que ocurra nada no
 *      es un test.
 *
 *   2. El inventario de triggers filtraba por nombre
 *      (`and t.tgname = 'trg_profiles_entitlement_guard'`), de modo que
 *      cualquier OTRO trigger sobre profiles —justo la clase de conflicto que
 *      estábamos buscando— quedaba invisible.
 *
 * Ver docs/SEGURIDAD-SUSCRIPCION.md
 */
declare const __dirname: string;
declare const require: (id: string) => any;

const fs = require('fs') as { readFileSync(f: string, enc: 'utf8'): string };
const path = require('path') as { join(...p: string[]): string };

const REPO = path.join(__dirname, '..', '..');
const VERIFY = fs.readFileSync(
  path.join(REPO, 'supabase', 'verify-subscription-guard.sql'),
  'utf8'
);
const DIAGNOSE = fs.readFileSync(
  path.join(REPO, 'supabase', 'diagnose-subscription-guard.sql'),
  'utf8'
);

describe('verify-subscription-guard.sql · defecto 1: veredictos en vacío', () => {
  it('los escenarios de service_role comprueban una transición, no el estado final', () => {
    // La forma rota era: v_ok := (v_tier_fin = 'pro');  — sin comparar con el
    // valor de partida. La forma correcta exige haber observado el paso previo.
    expect(VERIFY).toContain("v_ok  := (v_paso1 = 'free' and v_tier_fin = 'pro')");
    expect(VERIFY).toContain("v_ok  := (v_paso1 = 'pro' and v_tier_fin = 'free')");
  });

  it('no queda ningún veredicto que mire sólo el valor final', () => {
    const rotos = VERIFY.match(/v_ok\s*:=\s*\(v_tier_fin\s*=\s*'(pro|free)'\)\s*;/g) ?? [];
    expect(rotos).toEqual([]);
  });

  it('cada escenario de service_role informa de las filas afectadas', () => {
    // ROW_COUNT es lo que distingue "la RLS filtró la fila" (0 filas) de
    // "un trigger revirtió el valor" (1 fila, valor sin cambiar).
    const ocurrencias = VERIFY.match(/get diagnostics v_filas\d = row_count/g) ?? [];
    expect(ocurrencias.length).toBeGreaterThanOrEqual(4);
    expect(VERIFY).toContain('0 FILAS AFECTADAS');
  });
});

describe('verify-subscription-guard.sql · defecto 2: triggers invisibles', () => {
  it('el inventario NO filtra los triggers por nombre', () => {
    expect(VERIFY).not.toContain("t.tgname  = 'trg_profiles_entitlement_guard'");
    expect(VERIFY).not.toContain("t.tgname = 'trg_profiles_entitlement_guard'");
  });

  it('el inventario lista todos los triggers de usuario, ordenados por disparo', () => {
    expect(VERIFY).toContain('not t.tgisinternal');
    expect(VERIFY).toContain('order by t.tgname');
  });
});

describe('scripts SQL · seguridad de ejecución', () => {
  it.each([
    ['verify-subscription-guard.sql', VERIFY],
    ['diagnose-subscription-guard.sql', DIAGNOSE],
  ])('%s no contiene ningún COMMIT', (_nombre, sql) => {
    // Todo cambio debe deshacerse: los scripts sólo pueden terminar en rollback.
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
  });

  it.each([
    ['verify-subscription-guard.sql', VERIFY],
    ['diagnose-subscription-guard.sql', DIAGNOSE],
  ])('%s hace rollback de todo lo que abre', (_nombre, sql) => {
    const abre   = (sql.match(/^\s*begin\s*;/gim) ?? []).length;
    const cierra = (sql.match(/^\s*rollback\s*;/gim) ?? []).length;
    expect(abre).toBeGreaterThan(0);
    expect(cierra).toBe(abre);
  });

  it('las operaciones peligrosas viven dentro de una transacción con rollback', () => {
    // El GRANT del escenario de regresión y el DISABLE TRIGGER del diagnóstico
    // sólo son aceptables si están entre un begin y su rollback.
    const dentroDeTransaccion = (sql: string, needle: string) => {
      const pos = sql.indexOf(needle);
      if (pos < 0) return null;
      const begin = sql.lastIndexOf('\nbegin;', pos);
      const rollback = sql.indexOf('\nrollback;', pos);
      return begin >= 0 && rollback > pos;
    };

    expect(dentroDeTransaccion(VERIFY, 'grant update on public.profiles to authenticated')).toBe(true);
    expect(dentroDeTransaccion(DIAGNOSE, 'disable trigger trg_profiles_entitlement_guard')).toBe(true);
  });
});
