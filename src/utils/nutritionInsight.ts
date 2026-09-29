/**
 * Primer "Nutrition Insight" — vertical slice mínimo del copiloto
 * nutricional (evolución de VeganTrack de tracker → copiloto, ver
 * PRODUCT.md §8/§9/Pilar C). Responde a "¿qué debería vigilar hoy?"
 * combinando exactamente las mismas piezas que ya usan el Dashboard y
 * VeganScore — ningún umbral, fórmula ni fuente de datos nueva:
 *
 *   - `resolveMicroDisplay()`/`shouldShowMicroRecommendation()` (ya deciden
 *     "¿está bajo Y el dato es suficientemente fiable?" para HOY).
 *   - `MICRO_FOOD_SOURCES` (el mismo texto de sugerencia ya mostrado bajo
 *     cada barra de "Micronutrientes (RDA)").
 *   - el histórico ya calculado por `diaryStore.getMicroTrends()`, para
 *     distinguir "bajo hoy" de "bajo varios días seguidos" SIN inventar
 *     ningún dato: un día sin registros o con confianza insuficiente nunca
 *     cuenta como parte de un patrón (ver `isPattern` más abajo).
 *
 * Módulo puro, sin React ni stores — igual que `microRecommendations.ts`/
 * `veganScore.ts` — para poder testearlo sin montar ningún componente.
 */
import {
  MIN_SCORE_CONFIDENCE,
  meetsMinConfidence,
  MICRO_RDA,
  type MicroConfidence,
  type MicroDisplay,
} from '@/utils/nutrition';
import { MICRO_FOOD_SOURCES, shouldShowMicroRecommendation, type MicroKey } from '@/utils/microRecommendations';

/** Cuántos días antes de hoy, con el mismo micro también bajo y con dato
 *  fiable, hacen falta para hablar de "patrón" en vez de "hoy" — 2 días
 *  antes + hoy = 3 días seguidos. Deliberadamente corto: no reclama una
 *  tendencia semanal que el dato disponible no respalda todavía. */
const PATTERN_LOOKBACK_DAYS = 2;

/** Máximo de prioridades que devuelve el insight — nunca una lista larga. */
const MAX_PRIORITIES = 3;

export type InsightUrgency = 'today' | 'pattern';

export interface NutritionInsightPriority {
  key: MicroKey;
  label: string;
  /** known / target del propio día (comida + suplemento), sin recortar — sólo para ordenar y mostrar el %. */
  pct: number;
  urgency: InsightUrgency;
  /** Sugerencia de alimentos, idéntica a la que ya se ve bajo la barra del micro en el Dashboard. */
  reason: string;
}

/** Forma mínima de un día histórico que necesita este módulo — deliberadamente
 *  estructural (no importa `MicroTrendPoint` de `diaryStore`): los `utils/`
 *  puros de este proyecto nunca dependen de un store. */
export interface HistoricalMicroDay {
  micros: Record<MicroKey, { pct: number; hasEntries: boolean; confidence: MicroConfidence }>;
}

/**
 * ¿El micro `key` también estuvo bajo, con dato fiable, en TODOS los días de
 * `previousDays`? Sólo entonces se llama "patrón" — si `previousDays` está
 * vacío (usuario nuevo, sin histórico todavía) o cualquiera de esos días no
 * tiene datos suficientes (`hasEntries=false` o confianza por debajo del
 * mínimo), nunca se afirma un patrón: se queda en "hoy", que es lo único que
 * el dato disponible respalda.
 */
function isPattern(key: MicroKey, previousDays: HistoricalMicroDay[]): boolean {
  if (previousDays.length < PATTERN_LOOKBACK_DAYS) return false;
  return previousDays.every((day) => {
    const m = day.micros[key];
    return m.hasEntries && meetsMinConfidence(m.confidence, MIN_SCORE_CONFIDENCE) && m.pct < 0.9;
  });
}

/**
 * Construye hasta `MAX_PRIORITIES` prioridades de hoy a partir de los 6
 * `MicroDisplay` ya calculados por el Dashboard (misma instancia, no se
 * recalcula nada) y, opcionalmente, los días previos para distinguir "hoy"
 * de "patrón". Sin comida registrada hoy, `shouldShowMicroRecommendation`
 * devuelve `false` para los 6 (confidence='none' en todos) y esta función
 * devuelve `[]` de forma natural — no hace falta ninguna comprobación aparte
 * de "¿hay comida registrada?": es la propia regla de confianza la que ya
 * exige datos suficientes antes de decir nada.
 *
 * Orden: el micro más lejos de su objetivo (pct más bajo) primero — es la
 * única señal de prioridad que ya existe (no se inventa una ponderación
 * nueva entre nutrientes).
 */
export function buildNutritionInsight(
  today: Record<MicroKey, MicroDisplay>,
  previousDays: HistoricalMicroDay[] = []
): NutritionInsightPriority[] {
  const priorities: NutritionInsightPriority[] = [];

  for (const key of Object.keys(MICRO_RDA) as MicroKey[]) {
    const display = today[key];
    if (!shouldShowMicroRecommendation(display)) continue;
    priorities.push({
      key,
      label: MICRO_RDA[key].label,
      pct: display.pct,
      urgency: isPattern(key, previousDays) ? 'pattern' : 'today',
      reason: MICRO_FOOD_SOURCES[key],
    });
  }

  return priorities.sort((a, b) => a.pct - b.pct).slice(0, MAX_PRIORITIES);
}
