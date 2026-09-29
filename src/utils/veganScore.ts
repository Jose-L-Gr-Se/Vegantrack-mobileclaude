/**
 * VeganScore: puntuación compuesta 0-100 del día.
 * Portado 1:1 de la PWA (vegantrack/src/utils/veganScore.ts).
 *
 * ── VeganScore vs VeganScore nutricional ────────────────────────────────────
 * `computeVeganScore` es el de siempre: 5 componentes (calorías, proteína,
 * micros, fibra, racha), pensado para UN día ya conocido (normalmente hoy),
 * donde `streakCount` viene de `profiles.streak_count` en tiempo real.
 *
 * `computeVeganNutritionScore` (auditoría de histórico de VeganScore) es una
 * métrica DISTINTA y explícita, no un atajo de la anterior con la racha a 0:
 * existe porque `profiles.streak_count` es un único valor mutable sin
 * historial (no hay forma de saber cuál era la racha en un día pasado, y
 * reconstruirla mal sería peor que no mostrarla — ver auditoría de histórico
 * de VeganScore) y porque la propia racha no es un dato nutricional del día,
 * es un dato de comportamiento acumulado. Sus 4 componentes nutricionales
 * (calorías/proteína/micros/fibra) son EXACTAMENTE los mismos cálculos que
 * usa `computeVeganScore` — se comparten aquí en `computeNutritionParts`
 * para que nunca puedan divergir — pero su suma (máximo 90, no 100 al faltar
 * los 10 puntos de racha) se reescala a 0-100 preservando el peso relativo
 * de cada componente entre sí, para que la puntuación siga leyéndose en la
 * misma escala familiar 0-100 sin necesitar explicar una escala nueva.
 *
 * Limitación conocida y no oculta: para CUALQUIER día (incluidos los
 * pasados), ambas funciones usan `calorieTarget`/`proteinTarget`/`sex` tal
 * como se les pasen — normalmente los valores ACTUALES del perfil, porque
 * `profiles` tampoco guarda historial de objetivos ni de sexo. Si el usuario
 * cambió su objetivo calórico o su peso entre medias, un día histórico se
 * puntúa con el objetivo de HOY, no con el de entonces. Es la misma
 * aproximación que ya usa `getMicroTrends`/`MicroTrendsScreen` para las RDA
 * históricas (nunca se ha guardado el sexo/objetivos por día) — no es una
 * limitación nueva de esta métrica, y se documenta también en el punto donde
 * se construye la serie histórica (`diaryStore.getVeganNutritionScoreTrend`)
 * y en el copy que ve el usuario.
 */
import type { NutrientSummary, Sex, VeganScoreBreakdown, VeganNutritionScoreBreakdown } from '@/types';
import { MIN_SCORE_CONFIDENCE, meetsMinConfidence, resolveMicroDisplay } from '@/utils/nutrition';

interface NutritionPartsInput {
  summary: NutrientSummary;
  calorieTarget: number;
  proteinTarget: number;
  suppContributions: Partial<Record<string, number>>;
  sex: Sex | null;
}

interface NutritionParts {
  calScore: number;
  calLabel: string;
  proScore: number;
  proLabel: string;
  microScore: number;
  microLabel: string;
  fiberScore: number;
  fiberLabel: string;
}

/**
 * Los 4 componentes nutricionales, compartidos por `computeVeganScore` y
 * `computeVeganNutritionScore` — única fuente de esta lógica, nunca
 * duplicada entre las dos. No decide nada de racha ni de escala final: eso
 * es cosa de cada función pública, que combina estas partes de forma
 * distinta (una las suma tal cual sobre 100 junto a la racha; la otra las
 * reescala de 90 a 100 sin ella).
 */
function computeNutritionParts({
  summary,
  calorieTarget,
  proteinTarget,
  suppContributions,
  sex,
}: NutritionPartsInput): NutritionParts {
  // 1. Calorías (30 pts): en rango 85-115% del objetivo
  let calScore = 0;
  let calLabel = '';
  if (calorieTarget > 0) {
    const r = summary.calories / calorieTarget;
    if (r >= 0.85 && r <= 1.15) { calScore = 30; calLabel = 'En rango ✓'; }
    else if (r >= 0.7 && r <= 1.3) { calScore = 18; calLabel = 'Cerca'; }
    else if (r >= 0.5) { calScore = 8; calLabel = 'Lejos'; }
    else { calLabel = 'Muy lejos'; }
  }

  // 2. Proteína (25 pts)
  let proScore = 0;
  let proLabel = '';
  if (proteinTarget > 0) {
    const r = summary.protein_g / proteinTarget;
    if (r >= 1.0) { proScore = 25; proLabel = 'Objetivo ✓'; }
    else if (r >= 0.8) { proScore = 18; proLabel = 'Casi'; }
    else if (r >= 0.6) { proScore = 10; proLabel = 'En progreso'; }
    else if (r >= 0.4) { proScore = 4; proLabel = 'Bajo'; }
    else { proLabel = 'Muy bajo'; }
  }

  // 3. Micros clave (20 pts): B12, Vit D, Hierro.
  //    Fase 2 del P0 de micronutrientes (docs/NUTRICION-MICRONUTRIENTES.md):
  //    el valor de comida YA NO se descarta a 0 por baja cobertura —
  //    resolveMicroDisplay siempre expone el conocido real (comida +
  //    suplemento). Lo que antes era la puerta binaria `coverage >= 0.5`
  //    ahora sólo decide el crédito COMPLETO (ratio >= 0.9): exige una
  //    confianza mínima en el dato de comida (MIN_SCORE_CONFIDENCE), salvo
  //    que el suplemento por sí solo ya cubra el objetivo — ahí la cobertura
  //    de comida es irrelevante para el crédito. El medio crédito
  //    (0.5 <= ratio < 0.9) no exige esa confianza: ya era una franja de
  //    "en progreso", no de certeza total.
  //
  //    Antes: día con hierro=20mg pero cobertura=25% → foodVal=0 → 0 pts.
  //    Ahora: mismo caso → ratio real ≈ 20/8=2.5 → sí llega a ratio>=0.9,
  //    pero como la confianza es 'low' (< MIN_SCORE_CONFIDENCE) y no hay
  //    suplemento que cubra el objetivo, se otorga medio crédito, no
  //    completo — nunca 0 pts por un valor conocido real.
  const ironRda = sex === 'male' ? 8 : 18;
  const keyMicros = [
    { key: 'vitamin_b12_mcg', rda: 2.4 },
    { key: 'vitamin_d_mcg', rda: 15 },
    { key: 'iron_mg', rda: ironRda },
  ];
  const ptsEach = 20 / keyMicros.length;
  let microScore = 0;
  let coveredCount = 0;

  for (const { key, rda } of keyMicros) {
    const microData = summary.micros[key as keyof typeof summary.micros];
    const fromSupp = suppContributions[key] ?? 0;
    const display = resolveMicroDisplay(microData, fromSupp, rda);
    const ratio = display.pct;
    const supplementCoversTarget = rda > 0 && fromSupp >= rda;
    const confidentEnough = supplementCoversTarget || meetsMinConfidence(display.confidence, MIN_SCORE_CONFIDENCE);
    if (ratio >= 0.9 && confidentEnough) { microScore += ptsEach; coveredCount++; }
    else if (ratio >= 0.5) { microScore += ptsEach * 0.5; }
  }
  const microLabel = `${coveredCount}/3 cubiertos`;

  // 4. Fibra (15 pts)
  let fiberScore = 0;
  let fiberLabel = '';
  const f = summary.fiber_g;
  if (f >= 30) { fiberScore = 15; fiberLabel = 'Excelente ✓'; }
  else if (f >= 25) { fiberScore = 11; fiberLabel = 'Bien'; }
  else if (f >= 20) { fiberScore = 7; fiberLabel = 'En progreso'; }
  else if (f >= 10) { fiberScore = 3; fiberLabel = 'Bajo'; }
  else { fiberLabel = 'Muy bajo'; }

  return { calScore, calLabel, proScore, proLabel, microScore, microLabel, fiberScore, fiberLabel };
}

interface VeganScoreInput {
  summary: NutrientSummary;
  calorieTarget: number;
  proteinTarget: number;
  streakCount: number;
  suppContributions: Partial<Record<string, number>>;
  sex: Sex | null;
}

export function computeVeganScore({
  summary,
  calorieTarget,
  proteinTarget,
  streakCount,
  suppContributions,
  sex,
}: VeganScoreInput): VeganScoreBreakdown {
  if (summary.calories === 0) {
    const empty = (max: number) => ({ score: 0, max, label: 'Sin datos' });
    return {
      total: 0,
      calories: empty(30),
      protein: empty(25),
      micros: empty(20),
      fiber: empty(15),
      streak: empty(10),
      hasData: false,
    };
  }

  const { calScore, calLabel, proScore, proLabel, microScore, microLabel, fiberScore, fiberLabel } =
    computeNutritionParts({ summary, calorieTarget, proteinTarget, suppContributions, sex });

  // 5. Racha (10 pts)
  let streakScore = 0;
  let streakLabel = '';
  if (streakCount >= 7) { streakScore = 10; streakLabel = `${streakCount} días 🔥`; }
  else if (streakCount >= 3) { streakScore = 7; streakLabel = `${streakCount} días`; }
  else if (streakCount >= 1) { streakScore = 3; streakLabel = `${streakCount} día${streakCount > 1 ? 's' : ''}`; }
  else { streakLabel = 'Sin racha'; }

  return {
    total: Math.min(100, Math.round(calScore + proScore + microScore + fiberScore + streakScore)),
    calories: { score: Math.round(calScore), max: 30, label: calLabel },
    protein: { score: Math.round(proScore), max: 25, label: proLabel },
    micros: { score: Math.round(microScore), max: 20, label: microLabel },
    fiber: { score: Math.round(fiberScore), max: 15, label: fiberLabel },
    streak: { score: Math.round(streakScore), max: 10, label: streakLabel },
    hasData: true,
  };
}

/** Suma máxima de los 4 componentes nutricionales (30+25+20+15), antes de
 * reescalar a 0-100 — la constante vive aquí para que el factor de reescala
 * (`100 / NUTRITION_RAW_MAX`) no sea un número mágico repetido. */
const NUTRITION_RAW_MAX = 90;

interface VeganNutritionScoreInput {
  summary: NutrientSummary;
  calorieTarget: number;
  proteinTarget: number;
  suppContributions: Partial<Record<string, number>>;
  sex: Sex | null;
}

/**
 * "VeganScore nutricional": los mismos 4 componentes de comida de
 * `computeVeganScore` (calorías, proteína, micros clave, fibra), SIN racha
 * — ni incluida, ni a 0, ni aproximada de ninguna forma. No es
 * `computeVeganScore` con un streak inventado: es una métrica propia,
 * pensada para poder calcularse igual de bien para un día de hace una
 * semana que para hoy, porque sólo depende de datos que si existen para ese
 * día (comida + suplementos), nunca de un contador que sólo conoce su
 * valor actual.
 *
 * Reescalado: los 4 componentes sin racha suman como máximo 90, no 100 —
 * `total` se reescala proporcionalmente a 0-100 (mismo peso relativo entre
 * calorías/proteína/micros/fibra que en `computeVeganScore`) para que la
 * cifra final se siga leyendo en la escala 0-100 habitual. Los sub-scores
 * individuales (`calories`, `protein`, `micros`, `fiber`) NO se reescalan:
 * conservan su `max` original (30/25/20/15) para poder compararse
 * directamente, componente a componente, con los de `computeVeganScore`.
 */
export function computeVeganNutritionScore({
  summary,
  calorieTarget,
  proteinTarget,
  suppContributions,
  sex,
}: VeganNutritionScoreInput): VeganNutritionScoreBreakdown {
  if (summary.calories === 0) {
    const empty = (max: number) => ({ score: 0, max, label: 'Sin datos' });
    return {
      total: 0,
      calories: empty(30),
      protein: empty(25),
      micros: empty(20),
      fiber: empty(15),
      hasData: false,
    };
  }

  const { calScore, calLabel, proScore, proLabel, microScore, microLabel, fiberScore, fiberLabel } =
    computeNutritionParts({ summary, calorieTarget, proteinTarget, suppContributions, sex });

  const rawTotal = calScore + proScore + microScore + fiberScore;
  const total = Math.min(100, Math.round((rawTotal * 100) / NUTRITION_RAW_MAX));

  return {
    total,
    calories: { score: Math.round(calScore), max: 30, label: calLabel },
    protein: { score: Math.round(proScore), max: 25, label: proLabel },
    micros: { score: Math.round(microScore), max: 20, label: microLabel },
    fiber: { score: Math.round(fiberScore), max: 15, label: fiberLabel },
    hasData: true,
  };
}

export function getScoreColor(score: number): string {
  if (score >= 81) return '#2f5d41';
  if (score >= 61) return '#c98a2b';
  if (score >= 41) return '#cc7a3b';
  return '#c0473e';
}

export function getScoreLabel(score: number): string {
  if (score >= 81) return 'Excelente 🌟';
  if (score >= 61) return 'Bien 👍';
  if (score >= 41) return 'En progreso 💪';
  return 'Mejorable 🌱';
}
