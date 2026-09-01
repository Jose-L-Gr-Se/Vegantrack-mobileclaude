/**
 * Guardia de repositorio para el P0 de `subscription_tier`.
 *
 * No prueba comportamiento: escanea el código de producción del cliente para
 * que nadie reintroduzca una escritura de las columnas de suscripción. Es el
 * test que habría impedido el fallo original.
 *
 * Si este test falla, la corrección NO es añadir el fichero a la allowlist: es
 * dejar de escribir esas columnas desde el cliente. La única ruta legítima para
 * activar Pro es el webhook de RevenueCat (`service_role`).
 * Ver docs/SEGURIDAD-SUSCRIPCION.md
 */
// `@types/node` no está instalado y `tsconfig.json` carga sólo los tipos de
// jest, a propósito: esto es una app React Native y ampliar los globales a los
// de Node ocultaría errores reales en el código de la app. Declaramos aquí la
// superficie mínima que necesita este test, sin tocar la configuración global.
declare const __dirname: string;
declare const require: (id: string) => any;

interface DirEntry {
  name: string;
  isDirectory(): boolean;
}

const fs = require('fs') as {
  readdirSync(dir: string, opts: { withFileTypes: true }): DirEntry[];
  readFileSync(file: string, encoding: 'utf8'): string;
};

const path = require('path') as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};

const SRC = path.join(__dirname, '..');

/**
 * Ficheros de producción que pueden nombrar las columnas como clave.
 * Los tests quedan fuera del escaneo por completo.
 */
const KEY_MENTION_ALLOWLIST = [
  // Declaración del modelo de datos: describe el esquema, no lo escribe.
  path.join('src', 'types', 'index.ts'),
  // Define el propio invariante.
  path.join('src', 'utils', 'profilePatch.ts'),
];

const ENTITLEMENT_COLUMNS = [
  'subscription_tier',
  'subscription_expires_at',
  'stripe_customer_id',
] as const;

const AUTH_STORE = path.join('src', 'stores', 'authStore.ts');
const PRO_MODAL = path.join('src', 'components', 'ProModal.tsx');

/** Se construye en tiempo de ejecución para que este fichero no se auto-detecte. */
const PROFILES_TABLE_CALL = `from('${'profiles'}')`;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const FILES = sourceFiles(SRC).map((f) => ({
  rel: path.join('src', path.relative(SRC, f)),
  body: fs.readFileSync(f, 'utf8'),
}));

function fileBody(rel: string): string {
  const found = FILES.find((f) => f.rel === rel);
  if (!found) throw new Error(`No se encontró ${rel} en el escaneo`);
  return found.body;
}

describe('el cliente no escribe columnas de suscripción', () => {
  it('encuentra ficheros que escanear (el escáner funciona)', () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES.map((f) => f.rel)).toContain(AUTH_STORE);
  });

  it.each(ENTITLEMENT_COLUMNS)(
    'ningún fichero de producción usa %s como clave de objeto',
    (column) => {
      // `foo: valor` detecta una escritura; `profile?.subscription_tier === 'pro'`
      // (lectura, como en usePro) no lleva dos puntos detrás y no se marca.
      const pattern = new RegExp(`\\b${column}\\s*:`);
      const offenders = FILES.filter(
        (f) => !KEY_MENTION_ALLOWLIST.includes(f.rel) && pattern.test(f.body)
      ).map((f) => f.rel);

      expect(offenders).toEqual([]);
    }
  );

  it('sólo authStore habla con la tabla profiles', () => {
    const writers = FILES.filter((f) => f.body.includes(PROFILES_TABLE_CALL)).map((f) => f.rel);
    expect(writers).toEqual([AUTH_STORE]);
  });

  it('authStore sanea el patch antes de enviarlo', () => {
    expect(fileBody(AUTH_STORE)).toContain('sanitizeProfilePatch');
  });

  it('ProModal no escribe el perfil tras una compra ni al restaurar', () => {
    expect(fileBody(PRO_MODAL)).not.toContain('updateProfile');
  });
});
