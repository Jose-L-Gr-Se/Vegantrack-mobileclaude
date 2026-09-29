/**
 * Normalización de dosis de suplementos: unidad real de la etiqueta → unidad
 * canónica del nutriente. Fase 1 del P0 de unidades de suplementos — sólo el
 * núcleo puro, sin conectar a ningún consumidor todavía.
 *
 * Diagnóstico completo, inventario de las 34 filas reales de producción,
 * conversiones descartadas y su justificación, y el orden de las fases
 * siguientes: ver la auditoría de diseño que precede a este commit
 * (referenciada desde docs/NUTRICION-MICRONUTRIENTES.md).
 *
 * Regla central: esta función NUNCA convierte "a ojo". Toda combinación de
 * amount/unit/nutrientKey tiene una salida definida — éxito, necesita
 * revisión, o rechazo explícito con motivo — nunca un número silenciosamente
 * incorrecto ni un 0 que oculte que no se pudo convertir.
 *
 * No depende de React, no lee stores, no accede a Supabase. Determinista.
 */
import type { Supplement, SupplementNutrientKey } from '@/types';

// ── Unidades y alias ────────────────────────────────────────────────────────
//
// μ tiene dos representaciones Unicode visualmente casi idénticas que SÍ
// aparecen en datos reales de producción (la PWA escribe 'μg' en sus
// presets): U+03BC (letra griega mu minúscula) y U+00B5 (signo micro). Se
// definen con \u explícito para no depender de cómo se vea el carácter en un
// editor. Ambas se normalizan a 'mcg'.
const MU_GREEK = 'μ'; // μ
const MICRO_SIGN = 'µ'; // µ

export type CanonicalMassUnit = 'mcg' | 'mg' | 'g';

/** Token interno tras normalizar alias y mayúsculas/minúsculas. */
type UnitToken = CanonicalMassUnit | 'IU' | 'capsule' | 'drop';

const UNIT_ALIASES: Readonly<Record<string, UnitToken>> = {
  mcg: 'mcg',
  [`${MU_GREEK}g`]: 'mcg',
  [`${MICRO_SIGN}g`]: 'mcg',
  mg: 'mg',
  g: 'g',
  ui: 'IU',
  iu: 'IU',
  'cápsula': 'capsule',
  capsula: 'capsule',
  gota: 'drop',
};

function normalizeUnitToken(rawUnit: string): UnitToken | null {
  const key = rawUnit.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, key) ? UNIT_ALIASES[key] : null;
}

const MASS_FACTOR: Readonly<Record<CanonicalMassUnit, number>> = {
  mcg: 1,
  mg: 1_000,
  g: 1_000_000,
};

// ── Nutrientes ───────────────────────────────────────────────────────────────
//
/** Unidad canónica de cada nutriente rastreable por suplementos. */
export const SUPPLEMENT_CANONICAL_UNIT: Readonly<Record<SupplementNutrientKey, CanonicalMassUnit>> = {
  vitamin_b12_mcg: 'mcg',
  vitamin_d_mcg: 'mcg',
  iron_mg: 'mg',
  zinc_mg: 'mg',
  calcium_mg: 'mg',
  omega3_g: 'g',
  // iodine_mcg no está conectado a MICRO_RDA/NutrientSummary.micros en
  // ningún consumidor hoy (hallazgo de la auditoría, ajeno a este P0). Se
  // incluye aquí de todos modos: la función debe seguir siendo correcta
  // para él si algún día se conecta.
  iodine_mcg: 'mcg',
};

export function isSupplementNutrientKey(key: string): key is SupplementNutrientKey {
  return Object.prototype.hasOwnProperty.call(SUPPLEMENT_CANONICAL_UNIT, key);
}

/**
 * Nutrientes con una conversión IU→canónica verificada. NIH Office of
 * Dietary Supplements (fact sheets para profesionales de salud): 1 mcg de
 * vitamina D = 40 IU, válido para D2 y D3 por igual — el único de los
 * nutrientes soportados donde el factor no depende de la forma química.
 * Vitamina E (0.67–0.45 mg/IU según forma) y vitamina A (0.3/0.15/0.05 mcg
 * RAE por IU según fuente) NO tienen un factor único — y tampoco se rastrean
 * hoy en VeganTrack. No añadir aquí sin repetir la misma verificación.
 */
const NUTRIENTS_WITH_IU_SUPPORT: ReadonlySet<SupplementNutrientKey> = new Set(['vitamin_d_mcg']);

/** NIH ODS Vitamin D — Health Professional Fact Sheet: 1 mcg = 40 IU. */
const IU_PER_MCG_VITAMIN_D = 40;

// ── Plausibilidad ────────────────────────────────────────────────────────────
//
/**
 * Techos heurísticos de plausibilidad, en la unidad canónica de cada
 * nutriente. NO son límites clínicos ni una recomendación de seguridad — son
 * un margen amplio por encima de cualquier producto comercial conocido,
 * elegidos además para no disparar sobre ninguna de las 34 filas reales de
 * producción salvo las que la propia auditoría ya identificó como
 * probablemente erróneas. Su único trabajo es sugerir "revisa la unidad",
 * nunca "esta dosis es peligrosa". Únicos, con nombre — ningún otro fichero
 * debe repetir su propio número mágico.
 */
export const SUPPLEMENT_PLAUSIBILITY_CEILING: Readonly<Record<SupplementNutrientKey, number>> = {
  vitamin_b12_mcg: 10_000, // mcg — por encima del sublingual OTC más fuerte conocido (~5000 mcg)
  vitamin_d_mcg: 250, // mcg (= 10 000 UI) — por encima de los formatos "extra fuerza" habituales
  iron_mg: 100, // mg — por encima de dosis terapéuticas de hierro elemental típicas
  zinc_mg: 100, // mg — por encima de dosis de refuerzo puntual
  calcium_mg: 2_500, // mg — por encima de sumar varias tomas altas en un día
  omega3_g: 10, // g — muy por encima de protocolos de dosis alta
  iodine_mcg: 1_100, // mcg
};

// ── Resultado ────────────────────────────────────────────────────────────────

export interface SupplementDoseInput {
  amount: number;
  /** Texto tal cual está guardado o tal cual lo escribe el usuario — no se asume que ya es uno de los alias conocidos. */
  unit: string;
  /**
   * `string` (no `SupplementNutrientKey`) a propósito: la columna
   * `nutrient_key` de `public.supplements` no tiene CHECK constraint (mismo
   * hallazgo de la auditoría que para `dose_unit`), así que un valor
   * inesperado es un caso real a manejar, no un caso imposible a asumir.
   */
  nutrientKey: string | null;
}

export interface SupplementDoseSuccess {
  readonly status: 'success';
  /**
   * Tal cual, sin convertir, cuando `nutrientKey` es `null` (no hay
   * nutriente al que aportar, así que no hay canónica que calcular —
   * `getTodayContributions()` ya ignora hoy estas filas). Convertido a la
   * unidad canónica del nutriente cuando `nutrientKey` no es `null`.
   */
  readonly canonicalAmount: number;
  /** `null` únicamente cuando `nutrientKey` es `null`. */
  readonly canonicalUnit: CanonicalMassUnit | null;
  readonly plausible: true;
}

/**
 * La conversión se pudo calcular, pero el resultado supera el techo de
 * plausibilidad de §SUPPLEMENT_PLAUSIBILITY_CEILING. `ok` a nivel de
 * conversión (se conserva canonicalAmount/canonicalUnit, nunca se
 * descartan), pero NO debe usarse automáticamente en un cálculo nutricional
 * hasta que el usuario la revise — ver docs/NUTRICION-MICRONUTRIENTES.md.
 */
export interface SupplementDoseNeedsReview {
  readonly status: 'needs_review';
  readonly canonicalAmount: number;
  readonly canonicalUnit: CanonicalMassUnit;
  readonly plausible: false;
  /** Nota calmada, nunca alarmista — "comprueba la unidad", no "dosis peligrosa". */
  readonly reviewReason: string;
}

export type SupplementDoseRejectionReason =
  | 'invalid_amount'
  | 'unknown_unit'
  | 'unknown_nutrient'
  | 'unit_incompatible_with_nutrient'
  | 'requires_amount_per_unit';

export interface SupplementDoseUnsupported {
  readonly status: 'unsupported';
  readonly reason: SupplementDoseRejectionReason;
  readonly message: string;
}

export type SupplementDoseResult =
  | SupplementDoseSuccess
  | SupplementDoseNeedsReview
  | SupplementDoseUnsupported;

// ── La función ───────────────────────────────────────────────────────────────

export function normalizeSupplementDose(input: SupplementDoseInput): SupplementDoseResult {
  const { amount, unit: rawUnit, nutrientKey } = input;

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      status: 'unsupported',
      reason: 'invalid_amount',
      message: Number.isFinite(amount)
        ? 'La cantidad debe ser mayor que cero.'
        : 'La cantidad no es un número válido.',
    };
  }

  const token = normalizeUnitToken(rawUnit);
  if (token === null) {
    return {
      status: 'unsupported',
      reason: 'unknown_unit',
      message: `Unidad no reconocida: "${rawUnit}".`,
    };
  }

  // Sin nutriente asociado no hay canónica que calcular: la cantidad se usa
  // sólo para llevar la cuenta de la toma (cápsula, gota, mg, g...), nunca
  // entra en ningún cálculo de RDA — mismo criterio que
  // supplementStore.getTodayContributions() usa hoy para filtrar.
  if (nutrientKey === null) {
    return { status: 'success', canonicalAmount: amount, canonicalUnit: null, plausible: true };
  }

  if (!isSupplementNutrientKey(nutrientKey)) {
    return {
      status: 'unsupported',
      reason: 'unknown_nutrient',
      message: `Nutriente no reconocido: "${nutrientKey}".`,
    };
  }

  // "1 cápsula" o "1 gota" no es una cantidad nutricional: sólo lo sería si
  // supiéramos cuánto nutriente contiene cada unidad, dato que el modelo
  // actual no captura (Modelo B, no implementado — ver auditoría §05).
  if (token === 'capsule' || token === 'drop') {
    return {
      status: 'unsupported',
      reason: 'requires_amount_per_unit',
      message:
        'Esta unidad requiere especificar cuánto nutriente contiene cada unidad — no se puede asumir que 1 cápsula o 1 gota equivalga a 1 unidad del nutriente.',
    };
  }

  const canonicalUnit = SUPPLEMENT_CANONICAL_UNIT[nutrientKey];

  let canonicalAmount: number;
  if (token === 'IU') {
    if (!NUTRIENTS_WITH_IU_SUPPORT.has(nutrientKey)) {
      return {
        status: 'unsupported',
        reason: 'unit_incompatible_with_nutrient',
        message: 'No existe una conversión UI/IU verificada para este nutriente.',
      };
    }
    canonicalAmount = amount / IU_PER_MCG_VITAMIN_D;
  } else {
    canonicalAmount = (amount * MASS_FACTOR[token]) / MASS_FACTOR[canonicalUnit];
  }

  const ceiling = SUPPLEMENT_PLAUSIBILITY_CEILING[nutrientKey];
  if (canonicalAmount > ceiling) {
    return {
      status: 'needs_review',
      canonicalAmount,
      canonicalUnit,
      plausible: false,
      reviewReason: `Comprueba la unidad: ${canonicalAmount} ${canonicalUnit} es una cantidad inusualmente alta (por encima de ${ceiling} ${canonicalUnit}).`,
    };
  }

  return { status: 'success', canonicalAmount, canonicalUnit, plausible: true };
}

// ── Compatibilidad de unidades (Fase 3 — para el selector del editor) ───────
//
// Única fuente de verdad de "qué unidades tiene sentido ofrecer para este
// nutriente". Se deriva de las mismas tablas que usa normalizeSupplementDose
// (SUPPLEMENT_CANONICAL_UNIT, NUTRIENTS_WITH_IU_SUPPORT) — nunca las repite
// a mano. Ningún componente debe mantener su propia lista de unidades por
// nutriente. Nada de esto modifica normalizeSupplementDose(): son funciones
// nuevas, puramente derivadas, que la UI usa para decidir qué mostrar y qué
// permitir seleccionar — la validación real al guardar sigue siendo
// exclusivamente normalizeSupplementDose().

/** Unidades de recuento — nunca representan una cantidad nutricional (ver auditoría §05). */
const COUNT_UNITS = ['cápsula', 'gota'] as const;

/** Las tres unidades de masa, en un orden fijo — se antepone la canónica del nutriente cuando se conoce. */
const ALL_MASS_UNITS: readonly CanonicalMassUnit[] = ['mcg', 'mg', 'g'];

/**
 * Unidades a ofrecer en el selector para este nutriente, con la canónica
 * siempre primero.
 *
 * - `null` (sin nutriente asociado): unidades de masa + cápsula/gota — no
 *   hay "unidad correcta" que calcular, sólo un recuento (Modelo A, ver
 *   auditoría §05). IU se excluye a propósito: sin nutriente no tiene
 *   ningún significado.
 * - Un `nutrientKey` no reconocido (dato real posible: la columna
 *   `nutrient_key` no tiene CHECK constraint en Supabase) no inventa nada:
 *   cae a las tres unidades de masa, nunca cápsula/gota ni IU.
 */
export function compatibleUnitsFor(nutrientKey: string | null): readonly string[] {
  if (nutrientKey === null) return [...ALL_MASS_UNITS, ...COUNT_UNITS];
  if (!isSupplementNutrientKey(nutrientKey)) return ALL_MASS_UNITS;
  const canonical = SUPPLEMENT_CANONICAL_UNIT[nutrientKey];
  const otherMass = ALL_MASS_UNITS.filter((u) => u !== canonical);
  const iu = NUTRIENTS_WITH_IU_SUPPORT.has(nutrientKey) ? (['IU'] as const) : [];
  return [canonical, ...otherMass, ...iu];
}

/**
 * La unidad habitual de este nutriente — la misma canónica que usa
 * `normalizeSupplementDose()`. `null` o no reconocido → `'mg'` (sin
 * nutriente al que aportar, 'mg' es la unidad de masa más común entre los
 * presets existentes sin nutriente).
 */
export function defaultUnitFor(nutrientKey: string | null): string {
  if (nutrientKey !== null && isSupplementNutrientKey(nutrientKey)) return SUPPLEMENT_CANONICAL_UNIT[nutrientKey];
  return 'mg';
}

/** ¿`a` y `b` son la misma unidad, aceptando alias (p. ej. 'μg' y 'mcg')? */
export function unitsMatch(a: string, b: string): boolean {
  const tokenA = normalizeUnitToken(a);
  return tokenA !== null && tokenA === normalizeUnitToken(b);
}

/**
 * ¿Sigue siendo `unit` una opción válida para este nutriente? Compara por
 * token normalizado, no por el texto exacto — una unidad heredada de datos
 * antiguos (p. ej. 'μg') cuenta igual que si el usuario hubiera elegido
 * 'mcg' en el selector actual.
 */
export function isUnitCompatible(unit: string, nutrientKey: string | null): boolean {
  const token = normalizeUnitToken(unit);
  if (token === null) return false;
  return compatibleUnitsFor(nutrientKey).some((u) => normalizeUnitToken(u) === token);
}

/**
 * La unidad a mostrar en el editor tras cambiar de nutriente: conserva la
 * que ya había si sigue siendo compatible con el nuevo nutriente; si no,
 * cae a la canónica del nuevo nutriente. Pensada para llamarse SÓLO cuando
 * el usuario cambia el nutriente a mano — nunca al abrir el editor sobre un
 * suplemento ya guardado: un dato heredado incompatible no se reescribe
 * solo, es `normalizeSupplementDose()` al guardar quien lo protege.
 */
export function resolveUnitOnNutrientChange(nextNutrientKey: string | null, currentUnit: string): string {
  return isUnitCompatible(currentUnit, nextNutrientKey) ? currentUnit : defaultUnitFor(nextNutrientKey);
}

// ── Fase 5 — suplementos con dosis a revisar ─────────────────────────────────

/**
 * Suplementos CONFIGURADOS (no sólo los tomados hoy) cuya dosis normaliza a
 * `status: 'needs_review'` — convertible, pero por encima del techo de
 * plausibilidad de su nutriente. Es una propiedad de cómo está configurado
 * el suplemento (`dose_amount`/`dose_unit`/`nutrient_key`), no de un evento
 * de toma — por eso NO recibe ni consulta `takenToday`: un suplemento con
 * una dosis sospechosa lo sigue siendo el día que no se toma, y el usuario
 * necesita verlo para poder corregirlo antes de la próxima vez.
 *
 * Pura: no depende del store, de React ni de la navegación. Se implementa
 * como una proyección de `supplementsNeedingAttention()` (Fase 6) — misma
 * iteración, mismo `normalizeSupplementDose()`, nunca dos recorridos que
 * puedan divergir.
 */
export function supplementsNeedingReview(supplements: readonly Supplement[]): Supplement[] {
  return supplementsNeedingAttention(supplements)
    .filter((a) => a.dose.status === 'needs_review')
    .map((a) => a.supplement);
}

// ── Fase 6 — suplementos unsupported heredados ───────────────────────────────

/**
 * Un suplemento configurado cuya dosis no se puede contabilizar tal cual —
 * `needs_review` (convertible pero sospechosa) o `unsupported` (no
 * convertible en absoluto). Empareja el `Supplement` con su
 * `SupplementDoseResult` completo para que la capa de presentación decida
 * qué mostrar sin tener que volver a llamar a `normalizeSupplementDose()`.
 */
export interface SupplementAttention {
  supplement: Supplement;
  dose: SupplementDoseNeedsReview | SupplementDoseUnsupported;
}

/**
 * Suplementos CONFIGURADOS (tomados hoy o no — mismo criterio que
 * `supplementsNeedingReview()`) cuya dosis es `needs_review` O
 * `unsupported`. Nunca incluye un suplemento sin `nutrient_key`: esos son
 * de puro recuento (Creatina, Magnesio...) y son válidos dentro de su
 * propio modelo — no les falta nada que revisar.
 *
 * Pura: no depende del store, de React ni de la navegación. Es la única
 * función que DiaryScreen y ProfileScreen consultan para decidir el icono
 * de atención por fila — ninguna reimplementa el filtro combinado.
 */
export function supplementsNeedingAttention(supplements: readonly Supplement[]): SupplementAttention[] {
  const result: SupplementAttention[] = [];
  for (const s of supplements) {
    if (!s.nutrient_key) continue;
    const dose = normalizeSupplementDose({ amount: s.dose_amount, unit: s.dose_unit, nutrientKey: s.nutrient_key });
    if (dose.status === 'needs_review' || dose.status === 'unsupported') {
      result.push({ supplement: s, dose });
    }
  }
  return result;
}
