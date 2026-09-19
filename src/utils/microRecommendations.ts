/**
 * Dashboard accionable — recomendación alimentaria genérica bajo cada barra
 * de micronutriente cuando está baja y el dato del día es suficientemente
 * fiable. Mismo patrón que `supplementDoseCopy.ts`: módulo puro, sin React,
 * sin stores, con un diccionario de copy estático (nunca generado por IA) y
 * funciones que devuelven `string | null` (`null` = no mostrar nada).
 *
 * Cero diagnóstico médico, cero consejo individualizado: son fuentes
 * alimentarias vegetales genéricas para el nutriente, iguales para
 * cualquier usuario — nunca "a ti te falta X", ni una dosis, ni una
 * recomendación de exposición solar (vitamina D usa sólo fuentes
 * alimentarias/fortificadas en esta primera versión).
 *
 * Regla de decisión — reutiliza EXACTAMENTE lo que ya existe en
 * `nutrition.ts`, ningún umbral nuevo:
 *   - `display.pct < 0.9` (mismo corte que ya pinta la barra en verde).
 *   - `meetsMinConfidence(display.confidence, MIN_SCORE_CONFIDENCE)` (la
 *     misma confianza mínima que ya exige `veganScore.ts` para el crédito
 *     completo) — `'none'` y `'low'` quedan siempre excluidos porque no
 *     alcanzan esa confianza mínima (definida una única vez en `nutrition.ts`).
 */
import { MIN_SCORE_CONFIDENCE, meetsMinConfidence, MICRO_RDA, type MicroDisplay } from '@/utils/nutrition';

export type MicroKey = keyof typeof MICRO_RDA;

/**
 * Fuentes vegetales genéricas por nutriente — texto compacto y específico,
 * nunca una frase genérica repetida ("tu ingesta está baja...") delante de
 * cada una. Escrito a mano, no generado por IA.
 */
export const MICRO_FOOD_SOURCES: Record<MicroKey, string> = {
  vitamin_b12_mcg: 'Prueba con alimentos fortificados (bebidas vegetales, cereales) o un suplemento de B12.',
  iron_mg: 'Prueba con lentejas, garbanzos, tofu o frutos secos.',
  zinc_mg: 'Prueba con legumbres, semillas de calabaza, anacardos o avena.',
  calcium_mg: 'Prueba con tofu cuajado con calcio, bebida de soja fortificada, brócoli o almendras.',
  vitamin_d_mcg: 'Prueba con bebidas vegetales o cereales fortificados con vitamina D.',
  omega3_g: 'Prueba con semillas de lino o chía molidas, nueces o aceite de colza.',
};

/**
 * ¿Toca mostrar una recomendación para este micronutriente hoy? Pura y
 * testeable por separado de cualquier copy — nunca confunde el umbral de
 * "bajo" con el de "confío en el dato".
 */
export function shouldShowMicroRecommendation(display: MicroDisplay): boolean {
  return display.pct < 0.9 && meetsMinConfidence(display.confidence, MIN_SCORE_CONFIDENCE);
}

/**
 * Texto de recomendación para `key`, o `null` si no toca mostrar nada (dato
 * insuficiente — `none`/`low` — u objetivo ya cubierto, `pct >= 0.9`, venga
 * de comida o de suplemento). `DashboardScreen` llama a esto directamente,
 * sin reimplementar la regla.
 */
export function microRecommendationText(key: MicroKey, display: MicroDisplay): string | null {
  if (!shouldShowMicroRecommendation(display)) return null;
  return MICRO_FOOD_SOURCES[key];
}
