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
import type { SupplementNutrientKey } from '@/types';

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

function isSupplementNutrientKey(key: string): key is SupplementNutrientKey {
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
