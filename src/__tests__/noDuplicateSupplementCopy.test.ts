/**
 * Guardia de repositorio para las Fases 5 y 6 del P0 de unidades de
 * suplementos.
 *
 * No prueba comportamiento: escanea el código de producción para que nadie
 * vuelva a escribir a mano el texto de `needs_review`/`unsupported` en un
 * componente en vez de importarlo de `src/utils/supplementDoseCopy.ts` — la
 * única fuente de verdad. Mismo patrón que `noMicroCoverageGate.test.ts`.
 *
 * Si este test falla, la corrección NO es añadir el fichero a una
 * allowlist: es sustituir el literal por la constante/función importada.
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

const COPY_MODULE = path.join('src', 'utils', 'supplementDoseCopy.ts');
const UNITS_MODULE = path.join('src', 'utils', 'supplementUnits.ts');
const EDITOR = path.join('src', 'components', 'SupplementEditor.tsx');
const DIARY = path.join('src', 'screens', 'DiaryScreen.tsx');
const PROFILE = path.join('src', 'screens', 'ProfileScreen.tsx');
const DASHBOARD = path.join('src', 'screens', 'DashboardScreen.tsx');

/** Las cuatro superficies que muestran (o pueden mostrar) needs_review/unsupported. */
const CONSUMER_SITES = [EDITOR, DIARY, PROFILE, DASHBOARD];

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

/** Quita comentarios `//` y `/* *\/` para no marcar los propios comentarios que citan el texto como ejemplo. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// Fragmentos literales del copy de needs_review/unsupported (fuera del
// editor, que tiene su propio mapa de mensajes desde la Fase 3 — ver más
// abajo) — si aparecen en otro fichero, es que alguien lo volvió a escribir
// a mano en vez de importarlo de supplementDoseCopy.ts.
const COPY_LITERAL_FRAGMENTS = [
  'Esta cantidad parece alta para esta unidad', // NEEDS_REVIEW_WARNING_TEXT / NEEDS_REVIEW_ACCESSIBILITY_LABEL
  'no se está contando hoy', // describe*Banner (singular)
  'no se están contando hoy', // describe*Banner (plural)
  'no podemos interpretar su dosis', // UNSUPPORTED_GENERIC_TEXT
  'falta indicar cuánto nutriente contiene cada cápsula', // requires_amount_per_unit
];

describe('el copy de needs_review/unsupported vive en un único módulo (supplementDoseCopy.ts)', () => {
  it('encuentra ficheros que escanear (el escáner funciona)', () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES.map((f) => f.rel)).toContain(COPY_MODULE);
  });

  it.each(COPY_LITERAL_FRAGMENTS)('el fragmento "%s" no está duplicado fuera de supplementDoseCopy.ts', (fragment) => {
    const offenders = FILES.filter((f) => {
      if (f.rel === COPY_MODULE) return false; // la propia fuente de verdad
      return withoutComments(f.body).includes(fragment);
    }).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it('el editor importa el texto largo de needs_review desde supplementDoseCopy.ts (no lo reescribió inline)', () => {
    expect(fileBody(EDITOR)).toContain('NEEDS_REVIEW_WARNING_TEXT');
    expect(fileBody(EDITOR)).toMatch(/from ['"]@\/utils\/supplementDoseCopy['"]/);
  });

  it('Diario y Perfil importan la misma función de etiquetas de atención (ni cada uno la suya)', () => {
    for (const rel of [DIARY, PROFILE]) {
      expect(fileBody(rel)).toContain('attentionLabelsBySupplementId');
      expect(fileBody(rel)).toMatch(/from ['"]@\/utils\/supplementDoseCopy['"]/);
    }
  });

  it('Dashboard importa describeAttentionBanner (no calcula el plural ni combina los motivos a mano)', () => {
    expect(fileBody(DASHBOARD)).toContain('describeAttentionBanner');
    expect(fileBody(DASHBOARD)).toMatch(/from ['"]@\/utils\/supplementDoseCopy['"]/);
  });

  it('ninguna pantalla (fuera de supplementDoseCopy.ts y el editor) define su propio mapa de mensajes por reason', () => {
    // El editor SÍ mantiene el suyo desde la Fase 3 (UNSUPPORTED_MESSAGES) —
    // sirve a un momento distinto ("por qué no puedo guardar esto ahora
    // mismo"), documentado como tal en supplementDoseCopy.ts. Ningún otro
    // fichero debe declarar una estructura equivalente.
    const reasonKeyPattern = /requires_amount_per_unit\s*:/;
    const offenders = FILES.filter((f) => {
      if (f.rel === COPY_MODULE || f.rel === EDITOR) return false;
      return reasonKeyPattern.test(withoutComments(f.body));
    }).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });
});

describe('Fase 6 — unsupported heredado, activado sólo donde se ha diseñado', () => {
  it('Diario, Perfil y Dashboard delegan en supplementsNeedingAttention()/attentionLabelsBySupplementId() — ninguno reimplementa el filtro combinado', () => {
    for (const rel of [DIARY, PROFILE]) {
      // attentionLabelsBySupplementId ya envuelve supplementsNeedingAttention
      // (ver supplementDoseCopy.ts) — Diario/Perfil no necesitan llamarla
      // directamente, y no deberían mantener su propio filtro needs_review+unsupported.
      expect(fileBody(rel)).not.toMatch(/dose\.status\s*===\s*['"]needs_review['"]\s*\|\|\s*dose\.status\s*===\s*['"]unsupported['"]/);
    }
    expect(fileBody(DASHBOARD)).toContain('supplementStore');
    expect(fileBody(DASHBOARD)).toMatch(/status === 'needs_review' \|\| .*status === 'unsupported'/);
  });

  it('VeganScore y MicroTrends no se tocan por unsupported (ni por needs_review, ya cubierto en la Fase 2)', () => {
    const VEGAN_SCORE = path.join('src', 'utils', 'veganScore.ts');
    const MICRO_TRENDS = path.join('src', 'screens', 'MicroTrendsScreen.tsx');
    for (const rel of [VEGAN_SCORE, MICRO_TRENDS]) {
      const clean = withoutComments(fileBody(rel));
      expect(clean).not.toMatch(/unsupported/);
      expect(clean).not.toMatch(/needs_review/);
    }
  });

  it('el editor sigue siendo el único sitio con su propio mapa completo de mensajes de guardado (UNSUPPORTED_MESSAGES)', () => {
    expect(fileBody(EDITOR)).toContain('UNSUPPORTED_MESSAGES');
    const offenders = FILES.filter((f) => f.rel !== EDITOR && withoutComments(f.body).includes('UNSUPPORTED_MESSAGES')).map(
      (f) => f.rel
    );
    expect(offenders).toEqual([]);
  });
});
