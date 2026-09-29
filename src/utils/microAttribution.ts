/**
 * Atribución nutricional comida vs. suplementación — "VeganTrack no sólo sabe
 * cuánto tienes; sabe de dónde proviene".
 *
 * Módulo puro (sin React ni stores, como `nutritionInsight.ts`). NO calcula
 * ningún total, RDA ni porcentaje de objetivo: parte de las cifras que
 * `resolveMicroDisplay()` ya separa (`knownFood` y `supplement`) y sólo
 * describe de dónde viene lo ya conocido. `food + supplement` es siempre el
 * `known` de `resolveMicroDisplay` — esta capa no puede cambiar un total.
 *
 * ── Qué se puede afirmar y qué no ────────────────────────────────────────
 * `knownFood` es la suma de lo CONOCIDO: si parte de la comida registrada no
 * trae dato de este nutriente, el aporte real de la comida es MAYOR que
 * `knownFood` (cota inferior). Y un suplemento cuya dosis no se pudo
 * normalizar (`needs_review`/`unsupported`) no está en `supplement` en
 * absoluto. En ambos casos un reparto porcentual sería falsamente preciso,
 * así que `shares` sólo se calcula cuando NO hay ninguna parte desconocida:
 *
 *   - comida totalmente conocida: `coverageByGrams >= 1` (todos los gramos
 *     relevantes registrados traen dato) o no hay comida relevante ese día.
 *     Hereda la regla de relevancia de `summarizeEntries` (una entrada
 *     manual sin micros no cuenta contra la cobertura); no es un concepto de
 *     "día completo", que el modelo no soporta.
 *   - suplementos totalmente conocidos: ninguna toma de ese nutriente con
 *     dosis sin normalizar.
 *
 * Si no se cumple, se devuelven igualmente las cifras conocidas por separado
 * (sin porcentaje) y los indicadores de qué parte es desconocida — nunca un
 * 0 % o un 100 % que el dato no respalda. "Registrado" en el copy es
 * deliberado: describe lo que consta en la app, no toda la ingesta real.
 */

/** Forma mínima de un día — `MicroTrendPoint['micros'][key]` (diaryStore) la
 *  satisface estructuralmente sin que este módulo dependa de ningún store. */
export interface AttributionInput {
  /** Suma conocida de comida (= `MicroDisplay.knownFood`). */
  knownFood: number;
  /** Aporte de suplementos normalizados con éxito (= `MicroDisplay.supplement`). */
  supplement: number;
  /** Cobertura de comida por gramos, 0..1 (= `MicroDisplay.coverageByGrams`). */
  coverageByGrams: number;
  /** ¿Hay comida relevante registrada para este nutriente? */
  hasEntries: boolean;
  /** ¿Hubo alguna toma de este nutriente con dosis sin normalizar (aporte desconocido)? */
  supplementUnresolved: boolean;
}

/** Lo que aportan las cifras CONOCIDAS — no implica que no exista otra fuente desconocida. */
export type AttributionSource = 'none' | 'food' | 'supplement' | 'mixed';

export interface MicroAttribution {
  /** Días con datos incluidos en el cálculo (1 para un día, N para un periodo). */
  days: number;
  /** Media diaria conocida procedente de alimentos (cota inferior si `!foodFullyKnown`). */
  food: number;
  /** Media diaria procedente de suplementos normalizados. */
  supplement: number;
  /** `food + supplement`: exactamente el `known` de `resolveMicroDisplay` (media diaria en un periodo). */
  total: number;
  foodFullyKnown: boolean;
  supplementFullyKnown: boolean;
  /** Reparto 0..1 (suma 1). `null` cuando no es calculable de forma honesta. */
  shares: { food: number; supplement: number } | null;
  source: AttributionSource;
}

/**
 * Atribución de uno o varios días. Mismo criterio de "día con datos" que ya
 * usa la media de `MicroTrendsScreen` (`hasEntries || aporte > 0`): un día sin
 * registros ni suplemento no cuenta como un 0 confirmado. Para un único día,
 * pasar `[día]`.
 *
 * La completitud se evalúa sobre TODOS los días recibidos (también los
 * excluidos del promedio): una toma con aporte desconocido en cualquier día
 * del periodo impide afirmar un reparto del periodo.
 */
export function attributeMicroIntake(days: AttributionInput[]): MicroAttribution {
  const included = days.filter((d) => d.hasEntries || d.supplement > 0);
  const n = included.length;

  let foodSum = 0;
  let supplementSum = 0;
  for (const d of included) {
    foodSum += d.knownFood;
    supplementSum += d.supplement;
  }

  const foodFullyKnown = days.every((d) => !d.hasEntries || d.coverageByGrams >= 1);
  const supplementFullyKnown = days.every((d) => !d.supplementUnresolved);

  const totalSum = foodSum + supplementSum;
  const source: AttributionSource =
    totalSum <= 0 ? 'none' : supplementSum <= 0 ? 'food' : foodSum <= 0 ? 'supplement' : 'mixed';

  const shares =
    totalSum > 0 && foodFullyKnown && supplementFullyKnown
      ? { food: foodSum / totalSum, supplement: supplementSum / totalSum }
      : null;

  return {
    days: n,
    food: n > 0 ? foodSum / n : 0,
    supplement: n > 0 ? supplementSum / n : 0,
    total: n > 0 ? totalSum / n : 0,
    foodFullyKnown,
    supplementFullyKnown,
    shares,
    source,
  };
}

function fmtAmount(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

/**
 * Copy de la atribución, o `null` si no hay aporte conocido que describir.
 * Sin lenguaje médico ni valoración: describe el origen, nunca sugiere que
 * una fuente sea mejor que otra ni que falte algo.
 */
export function describeMicroAttribution(
  a: MicroAttribution,
  unit: string
): { headline: string; detail: string } | null {
  if (a.source === 'none') return null;

  if (a.shares) {
    // Enteros que suman 100 (el redondeo independiente podría dar 99/101).
    const supplementPct = Math.round(a.shares.supplement * 100);
    const foodPct = 100 - supplementPct;
    const headline =
      a.source === 'food'
        ? 'Todo el aporte registrado procede de alimentos'
        : a.source === 'supplement'
          ? 'Todo el aporte registrado procede de suplementos'
          : `${foodPct} % alimentos · ${supplementPct} % suplementos`;
    return {
      headline,
      detail: `${a.days > 1 ? 'Media diaria conocida' : 'Aporte conocido'}: ${fmtAmount(a.total)} ${unit}`,
    };
  }

  const parts: string[] = [];
  if (a.food > 0) parts.push(`${fmtAmount(a.food)} ${unit} de alimentos`);
  if (a.supplement > 0) parts.push(`${fmtAmount(a.supplement)} ${unit} de suplementos`);

  const reasons: string[] = [];
  if (!a.foodFullyKnown) reasons.push('parte de tus alimentos no tiene dato de este nutriente');
  if (!a.supplementFullyKnown) reasons.push('hay suplementos con dosis por revisar');

  return {
    headline: `${a.days > 1 ? 'Aporte conocido (media diaria)' : 'Aporte conocido'}: ${parts.join(' · ')}`,
    detail: `No calculamos porcentajes: ${reasons.join(' y ')}.`,
  };
}
