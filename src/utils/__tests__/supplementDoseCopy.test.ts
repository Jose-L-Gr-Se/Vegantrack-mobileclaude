/**
 * Fase 5 del P0 de unidades de suplementos — única fuente del copy.
 */
import {
  NEEDS_REVIEW_ACCESSIBILITY_LABEL,
  NEEDS_REVIEW_WARNING_TEXT,
  describeNeedsReviewBanner,
} from '@/utils/supplementDoseCopy';

describe('describeNeedsReviewBanner', () => {
  it('0 → null (nada que avisar, ninguna tarjeta)', () => {
    expect(describeNeedsReviewBanner(0)).toBeNull();
  });

  it('1 → singular exacto', () => {
    expect(describeNeedsReviewBanner(1)).toBe('1 suplemento no se está contando hoy — revisa su unidad');
  });

  it('3 → plural exacto', () => {
    expect(describeNeedsReviewBanner(3)).toBe('3 suplementos no se están contando hoy — revisa sus unidades');
  });

  it('negativo (defensivo, no debería ocurrir) → null, igual que 0', () => {
    expect(describeNeedsReviewBanner(-1)).toBeNull();
  });

  it('nunca usa lenguaje de peligro ni la palabra "error"', () => {
    for (const n of [1, 2, 5]) {
      const text = describeNeedsReviewBanner(n) ?? '';
      expect(text.toLowerCase()).not.toMatch(/error|peligro|alarma/);
    }
  });
});

describe('constantes de copy', () => {
  it('el texto largo del editor y la etiqueta accesible compacta son textos distintos, no el mismo string repetido', () => {
    expect(NEEDS_REVIEW_WARNING_TEXT).not.toBe(NEEDS_REVIEW_ACCESSIBILITY_LABEL);
    expect(NEEDS_REVIEW_WARNING_TEXT.length).toBeGreaterThan(0);
    expect(NEEDS_REVIEW_ACCESSIBILITY_LABEL.length).toBeGreaterThan(0);
  });

  it('ninguno de los dos textos usa la palabra "error"', () => {
    expect(NEEDS_REVIEW_WARNING_TEXT.toLowerCase()).not.toContain('error');
    expect(NEEDS_REVIEW_ACCESSIBILITY_LABEL.toLowerCase()).not.toContain('error');
  });
});
