/**
 * VeganScore: puntuación compuesta 0-100 del día.
 * Portado 1:1 de la PWA (vegantrack/src/utils/veganScore.ts).
 */
import type { NutrientSummary, Sex, VeganScoreBreakdown } from '@/types';

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
  //    El valor de comida solo cuenta si la cobertura de datos es >= 50%.
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
    const foodVal = (microData?.coverage ?? 0) >= 0.5 ? (microData?.value ?? 0) : 0;
    const ratio = rda > 0 ? (foodVal + fromSupp) / rda : 0;
    if (ratio >= 0.9) { microScore += ptsEach; coveredCount++; }
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
