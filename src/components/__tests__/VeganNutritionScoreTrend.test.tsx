/**
 * `VeganNutritionScoreTrend` — bloque compacto de histórico de VeganScore
 * nutricional (auditoría de histórico de VeganScore). Prueba sólo la UI: la
 * agregación/puntuación ya se prueba en `veganScore.nutritionScore.test.ts`
 * y `diaryStore.veganNutritionScoreTrend.test.ts`.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { VeganNutritionScoreTrend, type VeganNutritionTrendPoint } from '@/components/VeganNutritionScoreTrend';

jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  // `Svg` debe seguir renderizando sus hijos (Circle/Polyline) para poder
  // comprobar cuántos puntos se dibujan de verdad — a diferencia de otros
  // mocks de este repo que sólo necesitan que `Svg` no reviente.
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Circle: () => null,
  Polyline: () => null,
}));

function render(points: VeganNutritionTrendPoint[]) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<VeganNutritionScoreTrend points={points} />);
  });
  return renderer;
}

const DAYS = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];

describe('VeganNutritionScoreTrend', () => {
  it('muestra el título "VeganScore nutricional" (nunca "VeganScore" a secas) y la aclaración de que no incluye la racha', () => {
    const points: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: 70 }));
    const renderer = render(points);

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((c) => typeof c === 'string' && c.includes('VeganScore nutricional'))).toBe(true);
    expect(texts.some((c) => typeof c === 'string' && c.includes('No incluye la racha'))).toBe(true);
    // Transparencia sobre objetivos actuales (perfil sin historial de
    // calorie_target/protein_target_g) — no se oculta en el copy.
    expect(texts.some((c) => typeof c === 'string' && c.includes('objetivos actuales'))).toBe(true);
  });

  it('un día sin datos (score: null) no se muestra como 0: no aparece ningún "0" para ese día', () => {
    const points: VeganNutritionTrendPoint[] = [
      { date: DAYS[0], score: null },
      { date: DAYS[1], score: 80 },
      { date: DAYS[2], score: 90 },
      { date: DAYS[3], score: null },
      { date: DAYS[4], score: 75 },
      { date: DAYS[5], score: null },
      { date: DAYS[6], score: 60 },
    ];
    const renderer = render(points);

    // La media sólo se calcula sobre los días con dato real: (80+90+75+60)/4 = 76.25 → 76.
    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toContain(76);
    // Nunca se muestra un "0" en ningún sitio del bloque (ni como score de
    // un día ni como parte de la media) — un día sin datos no es un 0.
    expect(texts).not.toContain(0);
    expect(texts).not.toContain('0');
  });

  it('todos los días sin datos: no dibuja el gráfico ni una media falsa, muestra el estado vacío', () => {
    const points: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: null }));
    const renderer = render(points);

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((c) => typeof c === 'string' && c.includes('Aún no hay comidas registradas'))).toBe(true);
    expect(texts.some((c) => typeof c === 'string' && c.includes('de media'))).toBe(false);
  });

  it('con datos reales, sí dibuja el gráfico (Polyline/Circle) y la media', () => {
    const points: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: 85 }));
    const renderer = render(points);

    expect(
      renderer.root.findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Circle')
    ).toHaveLength(7);
    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toContain(85);
    expect(texts.some((c) => typeof c === 'string' && c.includes('de media'))).toBe(true);
  });
});
