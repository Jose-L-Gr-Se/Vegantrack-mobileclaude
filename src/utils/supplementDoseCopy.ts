/**
 * Fases 5 y 6 del P0 de unidades de suplementos — única fuente de verdad
 * del copy para las dosis que `normalizeSupplementDose()` no puede
 * contabilizar tal cual (`needs_review` y `unsupported`).
 *
 * Antes de la Fase 5, el texto de `needs_review` vivía como un literal
 * inline dentro de `SupplementEditor.tsx`. Con varias superficies nuevas
 * mostrando la misma idea (editor, listados, Dashboard), un literal
 * repetido en cada componente es exactamente el tipo de divergencia que
 * este proyecto ha estado evitando en cada fase anterior — así que vive
 * aquí una sola vez.
 *
 * Puro, sin React, sin stores — sólo depende de los TIPOS de
 * `supplementUnits.ts` (nunca al revés: la capa de dominio no conoce esta
 * de presentación). Ver docs/UNIDADES-SUPLEMENTOS.md §Fase 5 y §Fase 6.
 */
import {
  supplementsNeedingAttention,
  type SupplementDoseResult,
  type SupplementDoseRejectionReason,
} from '@/utils/supplementUnits';
import type { Supplement } from '@/types';

// ── needs_review (Fase 5 — sin cambios) ──────────────────────────────────────

/** Texto largo, mostrado como bloque junto al campo de dosis en el editor (Fase 3). */
export const NEEDS_REVIEW_WARNING_TEXT =
  'Esta cantidad parece alta para esta unidad. Comprueba que la unidad sea correcta.';

/**
 * Texto accesible compacto para el icono `needs_review` en los listados de
 * suplementos (Diario, Perfil) — icono solo, sin texto visible en la fila,
 * así que este es lo único que un lector de pantalla anuncia.
 */
export const NEEDS_REVIEW_ACCESSIBILITY_LABEL =
  'Necesita revisión: esta cantidad parece alta para esta unidad';

/**
 * Texto del aviso agregado en Dashboard cuando sólo hay `needs_review`
 * tomados hoy, o `null` si no hay ninguno — el propio `null` es la señal de
 * "no mostrar la tarjeta", para que ningún consumidor tenga que repetir la
 * comprobación `count > 0` por su cuenta.
 */
export function describeNeedsReviewBanner(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '1 suplemento no se está contando hoy — revisa su unidad';
  return `${count} suplementos no se están contando hoy — revisa sus unidades`;
}

// ── unsupported heredado (Fase 6) ────────────────────────────────────────────
//
// Distinto de los mensajes de `SupplementEditor.tsx` (`UNSUPPORTED_MESSAGES`,
// Fase 3): aquellos explican, mientras se edita, "por qué no se puede
// guardar esto". Estos explican, fuera del editor, "por qué este suplemento
// ya guardado no se está contando" — un momento y una audiencia distintos,
// misma disciplina de no tener dos frases que puedan divergir para la misma
// idea: cada uno vive en un único sitio.

const UNSUPPORTED_GENERIC_TEXT =
  'Este suplemento no se está contando porque no podemos interpretar su dosis.';

const UNSUPPORTED_REASON_TEXT: Record<SupplementDoseRejectionReason, string> = {
  invalid_amount: UNSUPPORTED_GENERIC_TEXT,
  unknown_unit: 'Este suplemento no se está contando porque no reconocemos su unidad.',
  unknown_nutrient: 'Este suplemento no se está contando porque no reconocemos su nutriente.',
  unit_incompatible_with_nutrient:
    'Este suplemento no se está contando porque su unidad no es compatible con este nutriente.',
  requires_amount_per_unit:
    'Este suplemento no se está contando porque falta indicar cuánto nutriente contiene cada cápsula.',
};

/**
 * Mensaje comprensible para un `SupplementDoseResult` con
 * `status: 'unsupported'` — nunca expone el nombre interno del `reason`.
 * `null` si el resultado no es `unsupported` (para poder llamarla sin
 * comprobar el status antes, igual que `unsupportedMessageFor` en el editor).
 */
export function unsupportedAttentionMessage(dose: SupplementDoseResult): string | null {
  if (dose.status !== 'unsupported') return null;
  return UNSUPPORTED_REASON_TEXT[dose.reason] ?? UNSUPPORTED_GENERIC_TEXT;
}

/**
 * Etiqueta accesible para el icono de atención en listados (Diario, Perfil)
 * — cubre `needs_review` y `unsupported` con el texto correcto para cada
 * uno; `null` para `success` (no debería llamarse en ese caso, pero es un
 * resultado seguro si ocurre).
 */
export function attentionAccessibilityLabel(dose: SupplementDoseResult): string | null {
  if (dose.status === 'needs_review') return NEEDS_REVIEW_ACCESSIBILITY_LABEL;
  return unsupportedAttentionMessage(dose);
}

/**
 * Mapa id de suplemento → etiqueta accesible, listo para consultar por fila
 * al recorrer un listado — DiaryScreen y ProfileScreen llaman a esto una
 * vez y luego hacen `.get(s.id)`, en vez de reconstruir el filtro cada uno.
 */
export function attentionLabelsBySupplementId(supplements: readonly Supplement[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of supplementsNeedingAttention(supplements)) {
    const label = attentionAccessibilityLabel(a.dose);
    if (label) map.set(a.supplement.id, label);
  }
  return map;
}

/**
 * Texto del aviso agregado en Dashboard cuando sólo hay `unsupported`
 * tomados hoy, o `null` si no hay ninguno. Deliberadamente distinto de
 * `describeNeedsReviewBanner()`: "revisa su dosis" en vez de "revisa su
 * unidad" — needs_review es (casi siempre) un problema de unidad;
 * unsupported puede ser eso u otra cosa (nutriente, cápsula sin cantidad
 * por unidad...), así que el texto no se compromete con "unidad".
 */
export function describeUnsupportedBanner(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '1 suplemento no se está contando hoy — revisa su dosis';
  return `${count} suplementos no se están contando hoy — revisa sus dosis`;
}

/**
 * Texto único del aviso agregado de Dashboard a partir de cuántos
 * suplementos tomados hoy son `needs_review` y cuántos `unsupported`.
 * Nunca mezcla los motivos por nutriente ni genera un mensaje distinto por
 * combinación — sólo tres formas: sólo needs_review, sólo unsupported, o
 * ambos (mensaje neutro, sin comprometerse con "unidad" ni "dosis").
 */
export function describeAttentionBanner(needsReviewCount: number, unsupportedCount: number): string | null {
  const total = needsReviewCount + unsupportedCount;
  if (total <= 0) return null;
  if (unsupportedCount === 0) return describeNeedsReviewBanner(needsReviewCount);
  if (needsReviewCount === 0) return describeUnsupportedBanner(unsupportedCount);
  return total === 1
    ? '1 suplemento no se está contando hoy — revísalo'
    : `${total} suplementos no se están contando hoy — revísalos`;
}
