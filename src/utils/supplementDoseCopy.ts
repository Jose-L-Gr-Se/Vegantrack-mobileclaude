/**
 * Fase 5 del P0 de unidades de suplementos — única fuente de verdad del
 * copy relacionado con `status: 'needs_review'` de `normalizeSupplementDose()`.
 *
 * Antes de esta fase, el texto del aviso vivía como un literal inline
 * dentro de `SupplementEditor.tsx`. Con tres superficies nuevas mostrando
 * la misma idea (editor, listados, Dashboard), un literal repetido tres
 * veces es exactamente el tipo de divergencia que este proyecto ha estado
 * evitando en cada fase anterior — así que vive aquí una sola vez.
 *
 * Puro, sin React, sin stores. Ver docs/UNIDADES-SUPLEMENTOS.md §Fase 5.
 */

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
 * Texto del aviso agregado en Dashboard, o `null` si no hay nada que avisar
 * (cero suplementos `needs_review` tomados hoy) — el propio `null` es la
 * señal de "no mostrar la tarjeta", para que ningún consumidor tenga que
 * repetir la comprobación `count > 0` por su cuenta.
 */
export function describeNeedsReviewBanner(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '1 suplemento no se está contando hoy — revisa su unidad';
  return `${count} suplementos no se están contando hoy — revisa sus unidades`;
}
