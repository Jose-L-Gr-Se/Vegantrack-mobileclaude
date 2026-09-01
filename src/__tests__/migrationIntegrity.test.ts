/**
 * Regresión de la migración de consolidación
 * (supabase/migrations/20260901000001_consolidate_subscription_guard.sql) y
 * de su reversión (…000002_rollback_consolidation.sql).
 *
 * No ejecuta SQL: comprueba, sobre el texto de los ficheros, las propiedades
 * que hacen segura esta migración concreta — que no se puede verificar en
 * ejecución porque nadie debe aplicarla contra una base de datos de prueba
 * automatizada (habla de `service_role`, `auth.role()`, RLS real).
 *
 * Ver docs/SEGURIDAD-SUSCRIPCION.md §6-9.
 */
declare const __dirname: string;
declare const require: (id: string) => any;

const fs = require('fs') as { readFileSync(f: string, enc: 'utf8'): string };
const path = require('path') as { join(...p: string[]): string };

const REPO = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations');

const CONSOLIDATE = fs.readFileSync(
  path.join(MIGRATIONS, '20260901000001_consolidate_subscription_guard.sql'),
  'utf8'
);
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, '20260901000002_rollback_consolidation.sql'),
  'utf8'
);
const DIAGNOSE_INSERT = fs.readFileSync(
  path.join(REPO, 'supabase', 'diagnose-insert-policy.sql'),
  'utf8'
);

/** Cuenta cuántas veces aparece una sentencia de control de transacción sola en su línea. */
function count(sql: string, stmt: RegExp): number {
  return (sql.match(stmt) ?? []).length;
}

/** Índice de la primera aparición de `needle`, o -1. Falla el test de forma legible si no aparece. */
function mustFind(sql: string, needle: string, label: string): number {
  const i = sql.indexOf(needle);
  if (i < 0) throw new Error(`No se encontró "${label}" en el fichero`);
  return i;
}

/**
 * Cada sentencia (separada por `;`), tras quitar los comentarios `--`, debe
 * empezar por SELECT. A diferencia de buscar la palabra "insert" en cualquier
 * parte del texto, esto no da falsos positivos con literales de cadena como
 * `privilege_type = 'INSERT'`, que este fichero necesita usar legítimamente.
 */
function allStatementsAreSelect(sql: string): string[] {
  const sinComentarios = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  return sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^select\b/i.test(s));
}

describe('20260901000001_consolidate_subscription_guard.sql', () => {
  it('es transaccional: exactamente un begin y un commit', () => {
    expect(count(CONSOLIDATE, /^begin;/gim)).toBe(1);
    expect(count(CONSOLIDATE, /^commit;/gim)).toBe(1);
    // Nunca debe quedar en rollback: es la migración que SÍ se aplica de verdad.
    expect(count(CONSOLIDATE, /^rollback;/gim)).toBe(0);
  });

  it('extiende protect_subscription_fields a las tres columnas de entitlement', () => {
    expect(CONSOLIDATE).toContain('new.subscription_tier = old.subscription_tier');
    expect(CONSOLIDATE).toContain('new.subscription_expires_at = old.subscription_expires_at');
    expect(CONSOLIDATE).toContain('new.stripe_customer_id = old.stripe_customer_id');
  });

  it('conserva la condición de decisión validada contra el webhook real (D10)', () => {
    expect(CONSOLIDATE).toContain("auth.role() is distinct from 'service_role'");
  });

  it('retira el mecanismo redundante: el trigger y su función', () => {
    expect(CONSOLIDATE).toContain('drop trigger if exists trg_profiles_entitlement_guard');
    expect(CONSOLIDATE).toContain(
      'drop function if exists public.enforce_profile_entitlement_guard()'
    );
  });

  it('la autoridad consolidada se crea/extiende ANTES de retirar la redundante (sin ventana sin protección)', () => {
    const posExtiende = mustFind(
      CONSOLIDATE,
      'create or replace function public.protect_subscription_fields()',
      'creación de protect_subscription_fields'
    );
    const posRetira = mustFind(
      CONSOLIDATE,
      'drop trigger if exists trg_profiles_entitlement_guard',
      'retirada de trg_profiles_entitlement_guard'
    );
    expect(posExtiende).toBeLessThan(posRetira);
  });

  it('no amplía protect_subscription_fields_trigger a INSERT (fuera de alcance, sin evidencia de vector)', () => {
    expect(CONSOLIDATE).toContain('before update on public.profiles');
    expect(CONSOLIDATE).not.toContain('before insert or update on public.profiles');
    expect(CONSOLIDATE).not.toContain('before insert on public.profiles');
  });

  it('no toca los privilegios por columna (capa 1): ni un GRANT ni un REVOKE', () => {
    const sinComentarios = CONSOLIDATE.split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    expect(sinComentarios).not.toMatch(/\bgrant\b/i);
    expect(sinComentarios).not.toMatch(/\brevoke\b/i);
  });

  it('no borra filas: ningún DELETE ni TRUNCATE', () => {
    const sinComentarios = CONSOLIDATE.split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    expect(sinComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(sinComentarios).not.toMatch(/\btruncate\b/i);
  });

  it('deja documentado en el propio esquema qué protege cada columna', () => {
    expect(CONSOLIDATE).toContain('comment on column public.profiles.subscription_tier');
    expect(CONSOLIDATE).toContain('comment on column public.profiles.subscription_expires_at');
    expect(CONSOLIDATE).toContain('comment on column public.profiles.stripe_customer_id');
  });
});

describe('20260901000002_rollback_consolidation.sql', () => {
  it('es transaccional: exactamente un begin y un commit, nunca un rollback', () => {
    expect(count(ROLLBACK, /^begin;/gim)).toBe(1);
    expect(count(ROLLBACK, /^commit;/gim)).toBe(1);
    expect(count(ROLLBACK, /^rollback;/gim)).toBe(0);
  });

  it('restaura protect_subscription_fields a su forma original (SIN stripe_customer_id)', () => {
    expect(ROLLBACK).toContain('NEW.subscription_tier = OLD.subscription_tier');
    expect(ROLLBACK).toContain('NEW.subscription_expires_at = OLD.subscription_expires_at');
    // La línea que sí extendía la función no debe reaparecer: si aparece,
    // este fichero ha dejado de ser una reversión fiel.
    expect(ROLLBACK).not.toContain('NEW.stripe_customer_id = OLD.stripe_customer_id');
  });

  it('recrea el mecanismo retirado por la consolidación', () => {
    expect(ROLLBACK).toContain('create or replace function public.enforce_profile_entitlement_guard');
    expect(ROLLBACK).toContain('create trigger trg_profiles_entitlement_guard');
    expect(ROLLBACK).toContain('before insert or update on public.profiles');
  });

  it('tampoco toca los privilegios por columna', () => {
    const sinComentarios = ROLLBACK.split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    expect(sinComentarios).not.toMatch(/\bgrant\b/i);
    expect(sinComentarios).not.toMatch(/\brevoke\b/i);
  });
});

describe('diagnose-insert-policy.sql', () => {
  it('es íntegramente de sólo lectura: toda sentencia es un SELECT', () => {
    const noSelect = allStatementsAreSelect(DIAGNOSE_INSERT);
    expect(noSelect).toEqual([]);
  });

  it('responde a las 7 preguntas de la investigación de INSERT', () => {
    // I1 RLS habilitada · I2 policies INSERT/ALL · I3 privilegio de tabla ·
    // I4 trigger sobre auth.users · I5 su código · I6 otras funciones SECURITY DEFINER
    expect(DIAGNOSE_INSERT).toContain('relrowsecurity');
    expect(DIAGNOSE_INSERT).toContain("polcmd in ('a', '*')");
    expect(DIAGNOSE_INSERT).toContain("privilege_type = 'INSERT'");
    expect(DIAGNOSE_INSERT).toContain("nspname = 'auth'");
    expect(DIAGNOSE_INSERT).toContain('pg_get_functiondef');
    expect(DIAGNOSE_INSERT).toContain('security_definer');
  });
});
