/**
 * Guardia de repositorio para el P0 de micronutrientes (Fase 2).
 *
 * No prueba comportamiento: escanea el código de producción para que nadie
 * reintroduzca una copia del gate antiguo `coverage < 0.5 ? value : 0` (o su
 * inverso `coverage >= 0.5 ? value : 0`), la causa raíz original del bug
 * (docs/NUTRICION-MICRONUTRIENTES.md). Tras la Fase 2 debe existir una única
 * cadena conceptual: `summarizeEntries() → resolveMicroDisplay() →
 * Dashboard / VeganScore / Tendencias`. Si este test falla, la corrección NO
 * es añadir el fichero a una allowlist: es sustituir la lógica reintroducida
 * por una llamada a `resolveMicroDisplay`.
 */
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

const DASHBOARD = path.join('src', 'screens', 'DashboardScreen.tsx');
const VEGAN_SCORE = path.join('src', 'utils', 'veganScore.ts');
const DIARY_STORE = path.join('src', 'stores', 'diaryStore.ts');
const NUTRITION = path.join('src', 'utils', 'nutrition.ts');

/** Los tres consumidores que tenían, cada uno por su cuenta, la copia del gate antiguo. */
const FORMER_GATE_SITES = [DASHBOARD, VEGAN_SCORE, DIARY_STORE];

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

/** Quita comentarios `//` y `/* *\/` para no marcar los propios comentarios que documentan el bug histórico. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// El gate antiguo tenía dos formas equivalentes (según cuál rama llevara el
// `value` real): `coverage >= 0.5 ? value : 0` y `coverage < 0.5 ? 0 : value`,
// además de la variante ya vista `coverage < 0.5 ? value : 0` invertida por
// error. Cubrimos las combinaciones de operador con cualquier campo de
// cobertura (`coverage`/`coverageByGrams`) seguido de un ternario con `0`.
const GATE_PATTERNS: RegExp[] = [
  /coverage(ByGrams)?\s*(>=|<|>|<=)\s*0\.5\s*\?[^:]*:\s*0\b/,
  /coverage(ByGrams)?\s*(>=|<|>|<=)\s*0\.5\s*\?\s*0\s*:/,
];

describe('ningún consumidor reintroduce el gate antiguo de micronutrientes', () => {
  it('encuentra ficheros que escanear (el escáner funciona)', () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES.map((f) => f.rel)).toContain(DASHBOARD);
  });

  it('el patrón de detección SÍ dispara sobre el gate antiguo (el test no es vacuo)', () => {
    expect(GATE_PATTERNS.some((re) => re.test('coverage >= 0.5 ? value : 0'))).toBe(true);
    expect(GATE_PATTERNS.some((re) => re.test('m.coverage < 0.5 ? 0 : m.value'))).toBe(true);
  });

  it('ningún fichero de producción (excluyendo comentarios) contiene el gate antiguo', () => {
    const offenders = FILES.filter((f) => {
      const clean = withoutComments(f.body);
      return GATE_PATTERNS.some((re) => re.test(clean));
    }).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it.each(FORMER_GATE_SITES)(
    '%s ya no calcula su propio "fromFood" condicionado a la cobertura',
    (rel) => {
      const clean = withoutComments(fileBody(rel));
      // La variable local que existía antes de la Fase 2 en los tres sitios.
      expect(clean).not.toMatch(/\bconst\s+fromFood\s*=/);
    }
  );

  it.each(FORMER_GATE_SITES)('%s delega la decisión en resolveMicroDisplay', (rel) => {
    expect(fileBody(rel)).toContain('resolveMicroDisplay');
  });

  it('resolveMicroDisplay vive en un único sitio (nutrition.ts) y no se reimplementa en otro fichero', () => {
    const definers = FILES.filter(
      (f) => f.rel !== NUTRITION && /function\s+resolveMicroDisplay\s*\(/.test(f.body)
    ).map((f) => f.rel);
    expect(definers).toEqual([]);
  });

  it('MIN_SCORE_CONFIDENCE se define una única vez (nutrition.ts)', () => {
    const definers = FILES.filter((f) => /\bMIN_SCORE_CONFIDENCE\s*[:=]/.test(f.body)).map(
      (f) => f.rel
    );
    expect(definers).toEqual([NUTRITION]);
  });
});
