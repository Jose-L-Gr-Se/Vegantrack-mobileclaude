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
 *     distinguir "bajo hoy" de "patrón de varios días" SIN inventar ningún
 *     dato (ver `patternEvidence` más abajo).
 *
 * Módulo puro, sin React ni stores — igual que `microRecommendations.ts`/
 * `veganScore.ts` — para poder testearlo sin montar ningún componente.
 *
 * ── Regla de "patrón" (auditoría del sistema de patrones nutricionales) ────
 * Sustituye a la regla original del bloque 1 (3 días consecutivos, los 3
 * estrictos) por una ventana de `PATTERN_WINDOW_DAYS` días (hoy + hasta
 * `PATTERN_WINDOW_DAYS - 1` días anteriores) con evidencia por RATIO, no por
 * racha: evita llamar "patrón" a algo que ocurrió sólo un par de veces por
 * casualidad, y nunca oculta cuántos días de la ventana tenían datos de
 * verdad. Un día "válido" es únicamente `hasEntries && confidence>=medium`
 * — el mismo criterio que ya exige `shouldShowMicroRecommendation` para hoy,
 * nunca un concepto nuevo de "día completo" que el modelo de datos no
 * soporta (`hasEntries`/`confidence` no dicen si se registró todo lo
 * comido ese día, sólo si lo registrado es suficiente para este nutriente).
 * Un día inválido (sin registros relevantes, o con confianza baja) no
 * cuenta ni como "bueno" ni como "malo": se excluye del recuento entero, en
 * el numerador y en el denominador.
 */
import {
  MIN_SCORE_CONFIDENCE,
  meetsMinConfidence,
  MICRO_RDA,
  type MicroConfidence,
  type MicroDisplay,
} from '@/utils/nutrition';
import { MICRO_FOOD_SOURCES, shouldShowMicroRecommendation, type MicroKey } from '@/utils/microRecommendations';

/** Máximo de prioridades que devuelve el insight — nunca una lista larga. */
const MAX_PRIORITIES = 3;

/** Mínimo de días con datos suficientes (de los hasta 7 de la ventana) para
 *  poder afirmar un patrón. Por debajo de esto la ventana es demasiado
 *  dispersa para decir nada — se queda en "hoy", igual que con un usuario
 *  nuevo sin histórico todavía. */
const MIN_VALID_DAYS = 4;

/** Proporción mínima de días válidos que deben estar bajos para hablar de
 *  patrón (no una racha fija): con el mínimo de 4 días válidos exige 3 de 4;
 *  con los 7 completos, 5 de 7 — nunca "dos veces por casualidad". */
const PATTERN_LOW_RATIO = 0.7;

export type InsightUrgency = 'today' | 'pattern';

export interface NutritionInsightPriority {
  key: MicroKey;
  label: string;
  /** known / target del propio día (comida + suplemento), sin recortar — sólo para ordenar y mostrar el %. */
  pct: number;
  urgency: InsightUrgency;
  /** Sugerencia de alimentos, idéntica a la que ya se ve bajo la barra del micro en el Dashboard. */
  reason: string;
  /**
   * Sólo presentes cuando `urgency === 'pattern'`: cuántos de los días con
   * datos suficientes de la ventana (incluye hoy) tuvieron este micro bajo,
   * y cuántos días de la ventana tenían datos suficientes en total. NUNCA
   * el tamaño de la ventana en sí (que puede incluir días sin registrar) —
   * el copy debe usar siempre este denominador real, nunca asumir 7.
   */
  lowDays?: number;
  validDays?: number;
}

/** Forma mínima de un día histórico que necesita este módulo — deliberadamente
 *  estructural (no importa `MicroTrendPoint` de `diaryStore`): los `utils/`
 *  puros de este proyecto nunca dependen de un store. */
export interface HistoricalMicroDay {
  micros: Record<MicroKey, { pct: number; hasEntries: boolean; confidence: MicroConfidence }>;
}

interface PatternEvidence {
  isPattern: boolean;
  lowDays: number;
  validDays: number;
}

/**
 * Evidencia de patrón para `key` sobre hoy + `previousDays` (hasta 6, para
 * una ventana total de 7). Hoy cuenta siempre como un día válido y bajo: a
 * esta función sólo se llega después de que `shouldShowMicroRecommendation`
 * ya haya confirmado eso mismo para hoy, así que no hace falta repetirlo.
 *
 * Un día previo sin registros relevantes (`hasEntries=false`) o con
 * confianza por debajo del mínimo se descarta del recuento entero — nunca
 * cuenta como "bajo" aunque su `pct` lo fuera, y nunca cuenta como "bueno"
 * aunque no lo fuera. Sin esto, un día sin datos podría inflar o desinflar
 * el patrón sin haber aportado ninguna información real.
 */
function patternEvidence(key: MicroKey, previousDays: HistoricalMicroDay[]): PatternEvidence {
  let validDays = 1; // hoy
  let lowDays = 1; // hoy, ya confirmado bajo por el llamador
  for (const day of previousDays) {
    const m = day.micros[key];
    if (!m.hasEntries || !meetsMinConfidence(m.confidence, MIN_SCORE_CONFIDENCE)) continue;
    validDays++;
    if (m.pct < 0.9) lowDays++;
  }
  return {
    isPattern: validDays >= MIN_VALID_DAYS && lowDays / validDays >= PATTERN_LOW_RATIO,
    lowDays,
    validDays,
  };
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

    const evidence = patternEvidence(key, previousDays);
    priorities.push({
      key,
      label: MICRO_RDA[key].label,
      pct: display.pct,
      urgency: evidence.isPattern ? 'pattern' : 'today',
      reason: MICRO_FOOD_SOURCES[key],
      ...(evidence.isPattern ? { lowDays: evidence.lowDays, validDays: evidence.validDays } : {}),
    });
  }

  return priorities.sort((a, b) => a.pct - b.pct).slice(0, MAX_PRIORITIES);
}
