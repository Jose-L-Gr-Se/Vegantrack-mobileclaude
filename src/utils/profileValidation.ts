/**
 * Validación de plausibilidad de los campos antropométricos del perfil
 * (altura, peso, fecha de nacimiento), compartida entre el onboarding y la
 * edición posterior del perfil.
 *
 * Auditoría de onboarding (HEAD f84384c): ni la PWA
 * (vegantrack/src/features/profile/OnboardingPage.tsx +
 * vegantrack/src/utils/nutrition.ts, verificado en el repo hermano) ni el
 * esquema de Supabase (`profiles.height_cm`/`weight_kg`/`birth_date`, sin
 * `CHECK`) definen ningún límite hoy. Los rangos de abajo son, por tanto,
 * elegidos aquí por primera vez — deliberadamente conservadores y
 * documentados como límites de PLAUSIBILIDAD FÍSICA, no médicos ni clínicos.
 * No deben usarse ni citarse como fuente de ninguna recomendación de salud
 * (CLAUDE.md §7), y no deben endurecerse sin revisar de nuevo la PWA por si
 * en el futuro define los suyos (CLAUDE.md §8: mantener paridad si existe).
 */

export const HEIGHT_CM_RANGE = { min: 90, max: 250 } as const;
export const WEIGHT_KG_RANGE = { min: 30, max: 300 } as const;
/** Edad derivada de `birth_date`. 13 años como piso genérico de "no es un niño pequeño", 120 como techo generoso por encima de la persona más longeva verificada. */
export const AGE_YEARS_RANGE = { min: 13, max: 120 } as const;

// ── Edad ─────────────────────────────────────────────────────────────────
// Movida aquí (antes vivía en nutrition.ts) para que este módulo no dependa
// de nutrition.ts y nutrition.ts pueda depender de éste sin import circular.
// nutrition.ts re-exporta `getAge` para no romper a quien ya lo importaba de
// `@/utils/nutrition`.

export function getAge(birthDate: string, ref: Date = new Date()): number {
  const birth = new Date(birthDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// ── Altura / peso ────────────────────────────────────────────────────────

export type NumericFieldStatus =
  | 'empty'
  | 'not_numeric'
  | 'invalid_number'
  | 'non_positive'
  | 'out_of_range'
  | 'valid';

export interface NumericFieldValidation {
  status: NumericFieldStatus;
  /** Sólo presente (no null) cuando status === 'valid'. */
  value: number | null;
}

/**
 * Normaliza un texto de entrada a número, aceptando coma o punto como
 * separador decimal — mismo criterio en onboarding y en edición de perfil,
 * a diferencia del comportamiento previo (sólo la edición aceptaba coma).
 */
function parseDecimalInput(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

function validateNumericField(
  raw: string,
  range: { min: number; max: number }
): NumericFieldValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { status: 'empty', value: null };

  const n = parseDecimalInput(raw);
  // Number(...) (a diferencia de parseFloat) no hace parseo parcial: "5cm"
  // da NaN, no 5 — así "no numérico" se distingue de forma fiable.
  if (Number.isNaN(n)) return { status: 'not_numeric', value: null };
  if (!Number.isFinite(n)) return { status: 'invalid_number', value: null }; // Infinity/-Infinity
  if (n <= 0) return { status: 'non_positive', value: null };
  if (n < range.min || n > range.max) return { status: 'out_of_range', value: null };
  return { status: 'valid', value: n };
}

export function validateHeightCm(raw: string): NumericFieldValidation {
  return validateNumericField(raw, HEIGHT_CM_RANGE);
}

export function validateWeightKg(raw: string): NumericFieldValidation {
  return validateNumericField(raw, WEIGHT_KG_RANGE);
}

/** Mensaje de usuario, calmado y no técnico, para cada estado no válido. */
export function numericFieldMessage(
  status: Exclude<NumericFieldStatus, 'valid' | 'empty'>,
  fieldLabel: string,
  range: { min: number; max: number }
): string {
  switch (status) {
    case 'not_numeric':
    case 'invalid_number':
      return `${fieldLabel}: introduce solo números.`;
    case 'non_positive':
      return `${fieldLabel}: debe ser mayor que cero.`;
    case 'out_of_range':
      return `${fieldLabel}: debe estar entre ${range.min} y ${range.max}.`;
  }
}

// ── Fecha de nacimiento ──────────────────────────────────────────────────

export type BirthDateStatus = 'empty' | 'invalid_format' | 'future_date' | 'out_of_range' | 'valid';

export interface BirthDateValidation {
  status: BirthDateStatus;
  age: number | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateBirthDate(raw: string, ref: Date = new Date()): BirthDateValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { status: 'empty', age: null };
  if (!ISO_DATE_RE.test(trimmed)) return { status: 'invalid_format', age: null };

  const d = new Date(trimmed);
  const [y, m, day] = trimmed.split('-').map(Number);
  const isRealCalendarDate =
    !Number.isNaN(d.getTime()) &&
    d.getUTCFullYear() === y &&
    d.getUTCMonth() + 1 === m &&
    d.getUTCDate() === day;
  if (!isRealCalendarDate) return { status: 'invalid_format', age: null }; // p.ej. 30 de febrero

  const age = getAge(trimmed, ref);
  if (age < 0) return { status: 'future_date', age };
  if (age < AGE_YEARS_RANGE.min || age > AGE_YEARS_RANGE.max) return { status: 'out_of_range', age };
  return { status: 'valid', age };
}

export function birthDateMessage(status: Exclude<BirthDateStatus, 'valid' | 'empty'>): string {
  switch (status) {
    case 'invalid_format':
      return 'Fecha de nacimiento: revisa que sea una fecha válida.';
    case 'future_date':
      return 'Fecha de nacimiento: no puede ser futura.';
    case 'out_of_range':
      return `Fecha de nacimiento: la edad debe estar entre ${AGE_YEARS_RANGE.min} y ${AGE_YEARS_RANGE.max} años.`;
  }
}

// ── Defensa adicional para calculateTDEE/calculateTargets ───────────────

/**
 * Última barrera antes de calcular objetivos: aunque algún llamador futuro
 * se salte la validación de la UI, un perfil con altura/peso/edad fuera de
 * los rangos de plausibilidad nunca debe producir un target. Pura, sin
 * conocimiento de UI — sólo trabaja con los valores numéricos ya resueltos
 * del perfil (no con texto de formulario).
 */
export function isPlausibleAnthropometrics(input: {
  height_cm: number;
  weight_kg: number;
  ageYears: number;
}): boolean {
  const { height_cm, weight_kg, ageYears } = input;
  if (!Number.isFinite(height_cm) || height_cm < HEIGHT_CM_RANGE.min || height_cm > HEIGHT_CM_RANGE.max) {
    return false;
  }
  if (!Number.isFinite(weight_kg) || weight_kg < WEIGHT_KG_RANGE.min || weight_kg > WEIGHT_KG_RANGE.max) {
    return false;
  }
  if (!Number.isFinite(ageYears) || ageYears < AGE_YEARS_RANGE.min || ageYears > AGE_YEARS_RANGE.max) {
    return false;
  }
  return true;
}
