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
import { getScoreColor } from '@/utils/veganScore';

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

function render(points: VeganNutritionTrendPoint[], inProgressDate?: string) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<VeganNutritionScoreTrend points={points} inProgressDate={inProgressDate} />);
  });
  return renderer;
}

function byMockName(renderer: TestRenderer.ReactTestRenderer, name: string) {
  return renderer.root.findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === name);
}

const DAYS = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];

describe('VeganNutritionScoreTrend', () => {
  it('muestra el título "VegeScore nutricional" (nunca "VegeScore" a secas) y la aclaración de que no incluye la racha', () => {
    const points: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: 70 }));
    const renderer = render(points);

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((c) => typeof c === 'string' && c.includes('VegeScore nutricional'))).toBe(true);
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

  describe('día en curso (`inProgressDate` = hoy)', () => {
    const TODAY = DAYS[6];
    const SCORE_COLORS = new Set([0, 41, 61, 81].map(getScoreColor));
    /** Seis días pasados cerrados a 80 y hoy con un valor parcial de 10. */
    const WEEK: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: date === TODAY ? 10 : 80 }));

    it('sin `inProgressDate` el comportamiento es el de siempre: hoy cuenta en la media y lleva color de valoración', () => {
      const renderer = render(WEEK);
      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      // (6·80 + 10) / 7 = 70
      expect(texts).toContain(70);
      const circles = byMockName(renderer, 'Circle');
      expect(circles).toHaveLength(7);
      expect(circles[6].props.fill).toBe(getScoreColor(10));
    });

    it('la media sólo resume días cerrados: el valor parcial de hoy no la contamina', () => {
      const renderer = render(WEEK, TODAY);
      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).toContain(80);
      expect(texts).not.toContain(70);
    });

    it('los días pasados siguen igual: mismo punto, mismo color de valoración y misma línea', () => {
      const renderer = render(WEEK, TODAY);
      const circles = byMockName(renderer, 'Circle');
      expect(circles).toHaveLength(7);
      for (const c of circles.slice(0, 6)) {
        expect(c.props.fill).toBe(getScoreColor(80));
        expect(c.props.r).toBe(4);
      }
      // La línea une los 6 días cerrados y no llega a hoy.
      const lines = byMockName(renderer, 'Polyline');
      expect(lines).toHaveLength(1);
      expect(String(lines[0].props.points).split(' ')).toHaveLength(6);
    });

    it('hoy se sigue dibujando, pero hueco y neutro — nunca con un color de valoración', () => {
      const renderer = render(WEEK, TODAY);
      const today = byMockName(renderer, 'Circle')[6];
      expect(SCORE_COLORS.has(today.props.fill)).toBe(false);
      expect(SCORE_COLORS.has(today.props.stroke)).toBe(false);
      expect(today.props.strokeWidth).toBeGreaterThan(0);
      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).toContain('Hoy está en curso: aparece sin valorar y no cuenta en la media.');
    });

    it('si sólo hay datos de hoy: gráfico con el punto en curso, sin media y sin el estado vacío', () => {
      const points: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: date === TODAY ? 35 : null }));
      const renderer = render(points, TODAY);
      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts.some((c) => typeof c === 'string' && c.includes('de media'))).toBe(false);
      expect(texts.some((c) => typeof c === 'string' && c.includes('Aún no hay comidas registradas'))).toBe(false);
      expect(byMockName(renderer, 'Circle')).toHaveLength(1);
      expect(texts).toContain('Hoy está en curso: aparece sin valorar y no cuenta en la media.');
    });

    it('si hoy aún no tiene datos, no aparece la nota de "en curso" y el resto no cambia', () => {
      const points: VeganNutritionTrendPoint[] = DAYS.map((date) => ({ date, score: date === TODAY ? null : 80 }));
      const withProp = render(points, TODAY);
      const withoutProp = render(points);
      expect(JSON.stringify(withProp.toJSON())).toBe(JSON.stringify(withoutProp.toJSON()));
      const texts = withProp.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).not.toContain('Hoy está en curso: aparece sin valorar y no cuenta en la media.');
    });
  });
});
