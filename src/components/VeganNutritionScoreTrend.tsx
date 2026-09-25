/**
 * Bloque compacto de evolución del "VeganScore nutricional" (auditoría de
 * histórico de VeganScore) — se integra bajo el VeganScore de hoy en
 * `DashboardScreen`, no es una pantalla nueva.
 *
 * Deliberadamente NO reutiliza el gráfico de `MicroTrendsScreen`: ese
 * componente está hecho a medida para series en % de una RDA (línea de
 * referencia al 100%, selector de periodo/micro, escala `capY` pensada para
 * porcentajes) — adaptarlo a una escala 0-100 sin RDA habría significado
 * tocar una pantalla ya probada y fuera de alcance de esta ronda, o llevar
 * sus props/estado a un componente genérico a medio camino entre los dos
 * casos. Este componente es deliberadamente pequeño: una polilínea con
 * huecos reales donde no hay dato, sin ejes, sin selector, sin línea de
 * referencia — no hay gráfico complejo que duplicar.
 */
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Card, EmptyState } from '@/components/ui';
import { spacing, useTheme } from '@/theme';
import { getScoreColor } from '@/utils/veganScore';

export interface VeganNutritionTrendPoint {
  date: string;
  /** `null` = sin ningún registro ese día — nunca se dibuja como un 0. */
  score: number | null;
}

const W = 280;
const H = 64;
const DOT_R = 4;

/** Inicial del día de la semana en español (L/M/X/J/V/S/D) — misma
 * convención de parseo (`T12:00:00`, hora local a mediodía) que el resto de
 * `utils/dates.ts` para no desplazar el día por huso horario. */
function weekdayInitial(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-ES', { weekday: 'narrow' }).toUpperCase();
}

export function VeganNutritionScoreTrend({ points }: { points: VeganNutritionTrendPoint[] }) {
  const t = useTheme();
  const known = points.filter((p): p is { date: string; score: number } => p.score !== null);
  const hasAnyData = known.length > 0;
  const avg = hasAnyData ? Math.round(known.reduce((s, p) => s + p.score, 0) / known.length) : null;

  const n = Math.max(points.length, 1);
  const toX = (i: number) => (i / Math.max(n - 1, 1)) * W;
  const toY = (score: number) => H - DOT_R - (score / 100) * (H - DOT_R * 2);

  // Segmentos de polilínea sólo entre días CONSECUTIVOS con dato — un hueco
  // real (día sin registrar) rompe la línea en vez de interpolarla, para no
  // sugerir un valor que no existe entre dos días con datos.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.score === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ x: toX(i), y: toY(p.score) });
    }
  });
  if (current.length) segments.push(current);

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: t.textMuted }}>
            VeganScore nutricional · 7 días
          </Text>
          {hasAnyData ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <Text style={{ fontSize: 28, fontWeight: '800', color: getScoreColor(avg!) }}>{avg}</Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>de media</Text>
            </View>
          ) : null}
        </View>
      </View>

      {hasAnyData ? (
        <>
          <View style={{ height: H }}>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              {segments.map((seg, si) =>
                seg.length > 1 ? (
                  <Polyline
                    key={si}
                    points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={t.primary}
                    strokeWidth={2.5}
                  />
                ) : null
              )}
              {points.map((p, i) =>
                p.score !== null ? (
                  <Circle key={i} cx={toX(i)} cy={toY(p.score)} r={DOT_R} fill={getScoreColor(p.score)} />
                ) : null
              )}
            </Svg>
          </View>
          <View style={{ flexDirection: 'row' }}>
            {points.map((p) => (
              <Text
                key={p.date}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 10,
                  fontWeight: '700',
                  color: p.score !== null ? t.textSecondary : t.textMuted,
                }}
              >
                {weekdayInitial(p.date)}
              </Text>
            ))}
          </View>
        </>
      ) : (
        <EmptyState emoji="📅" text="Aún no hay comidas registradas en los últimos 7 días." />
      )}

      <Text style={{ color: t.textMuted, fontSize: 11, lineHeight: 15 }}>
        No incluye la racha — el VeganScore de arriba sí la incluye. Calculado con tus objetivos actuales de
        calorías y proteína.
      </Text>
    </Card>
  );
}
