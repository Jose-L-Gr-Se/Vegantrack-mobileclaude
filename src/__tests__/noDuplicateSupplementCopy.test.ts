/**
 * Guardia de repositorio para la Fase 5 del P0 de unidades de suplementos.
 *
 * No prueba comportamiento: escanea el código de producción para que nadie
 * vuelva a escribir a mano el texto de `needs_review` en un componente en
 * vez de importarlo de `src/utils/supplementDoseCopy.ts` — la única fuente
 * de verdad. Mismo patrón que `noMicroCoverageGate.test.ts`.
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
const EDITOR = path.join('src', 'components', 'SupplementEditor.tsx');
const DIARY = path.join('src', 'screens', 'DiaryScreen.tsx');
const PROFILE = path.join('src', 'screens', 'ProfileScreen.tsx');
const DASHBOARD = path.join('src', 'screens', 'DashboardScreen.tsx');

/** Las cuatro superficies que muestran (o pueden mostrar) el aviso needs_review. */
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

// Fragmentos literales del copy — si aparecen fuera de supplementDoseCopy.ts
// (comentarios ya excluidos), es que alguien lo volvió a escribir a mano.
const COPY_LITERAL_FRAGMENTS = [
  'Esta cantidad parece alta para esta unidad', // NEEDS_REVIEW_WARNING_TEXT / NEEDS_REVIEW_ACCESSIBILITY_LABEL
  'no se está contando hoy', // describeNeedsReviewBanner (singular)
  'no se están contando hoy', // describeNeedsReviewBanner (plural)
];

describe('el copy de needs_review vive en un único módulo (supplementDoseCopy.ts)', () => {
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

  it('el editor importa el texto largo desde supplementDoseCopy.ts (no lo reescribió inline)', () => {
    expect(fileBody(EDITOR)).toContain('NEEDS_REVIEW_WARNING_TEXT');
    expect(fileBody(EDITOR)).toMatch(/from ['"]@\/utils\/supplementDoseCopy['"]/);
  });

  it('Diario y Perfil importan la misma etiqueta accesible (ni cada uno la suya)', () => {
    for (const rel of [DIARY, PROFILE]) {
      expect(fileBody(rel)).toContain('NEEDS_REVIEW_ACCESSIBILITY_LABEL');
      expect(fileBody(rel)).toMatch(/from ['"]@\/utils\/supplementDoseCopy['"]/);
    }
  });

  it('Dashboard importa describeNeedsReviewBanner (no calcula el plural a mano)', () => {
    expect(fileBody(DASHBOARD)).toContain('describeNeedsReviewBanner');
    expect(fileBody(DASHBOARD)).toMatch(/from ['"]@\/utils\/supplementDoseCopy['"]/);
  });

  it('Diario y Perfil reutilizan la misma función de filtrado (supplementsNeedingReview), ninguno la reimplementa', () => {
    for (const rel of [DIARY, PROFILE]) {
      expect(fileBody(rel)).toContain('supplementsNeedingReview');
      expect(fileBody(rel)).toMatch(/from ['"]@\/utils\/supplementUnits['"]/);
    }
  });
});

describe('unsupported sigue sin activarse en las superficies de esta fase (fuera de alcance)', () => {
  it.each(CONSUMER_SITES.filter((f) => f !== EDITOR))(
    "%s no comprueba status === 'unsupported' (sólo el editor, que ya lo hacía desde la Fase 3)",
    (rel) => {
      expect(fileBody(rel)).not.toMatch(/status\s*===\s*['"]unsupported['"]/);
    }
  );
});
