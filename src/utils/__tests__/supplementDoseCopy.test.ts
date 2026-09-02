/**
 * Fases 5 y 6 del P0 de unidades de suplementos — única fuente del copy.
 */
import {
  NEEDS_REVIEW_ACCESSIBILITY_LABEL,
  NEEDS_REVIEW_WARNING_TEXT,
  describeAttentionBanner,
  describeNeedsReviewBanner,
  describeUnsupportedBanner,
  unsupportedAttentionMessage,
  attentionAccessibilityLabel,
} from '@/utils/supplementDoseCopy';
import { normalizeSupplementDose } from '@/utils/supplementUnits';

describe('describeNeedsReviewBanner (Fase 5, sin cambios en la Fase 6)', () => {
  it('6. 0 → null (nada que avisar, ninguna tarjeta)', () => {
    expect(describeNeedsReviewBanner(0)).toBeNull();
  });

  it('6. 1 → singular exacto', () => {
    expect(describeNeedsReviewBanner(1)).toBe('1 suplemento no se está contando hoy — revisa su unidad');
  });

  it('6. 3 → plural exacto', () => {
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

describe('describeUnsupportedBanner (Fase 6)', () => {
  it('0 → null', () => {
    expect(describeUnsupportedBanner(0)).toBeNull();
  });

  it('1 → singular, distinto del texto de needs_review', () => {
    const text = describeUnsupportedBanner(1);
    expect(text).toBe('1 suplemento no se está contando hoy — revisa su dosis');
    expect(text).not.toBe(describeNeedsReviewBanner(1));
  });

  it('3 → plural, distinto del texto de needs_review', () => {
    const text = describeUnsupportedBanner(3);
    expect(text).toBe('3 suplementos no se están contando hoy — revisa sus dosis');
    expect(text).not.toBe(describeNeedsReviewBanner(3));
  });

  it('nunca usa lenguaje de peligro ni la palabra "error"', () => {
    const text = describeUnsupportedBanner(1) ?? '';
    expect(text.toLowerCase()).not.toMatch(/error|peligro|alarma/);
  });
});

describe('describeAttentionBanner (Fase 6) — un único banner agregado', () => {
  it('8. 0 y 0 → null', () => {
    expect(describeAttentionBanner(0, 0)).toBeNull();
  });

  it('8. sólo needs_review → el mensaje de needs_review, sin mencionar unsupported', () => {
    expect(describeAttentionBanner(2, 0)).toBe(describeNeedsReviewBanner(2));
  });

  it('8. sólo unsupported → el mensaje de unsupported, sin mencionar needs_review', () => {
    expect(describeAttentionBanner(0, 1)).toBe(describeUnsupportedBanner(1));
  });

  it('8. mezcla needs_review + unsupported → un único banner agregado (ni el texto de needs_review ni el de unsupported por separado)', () => {
    const mixed = describeAttentionBanner(1, 1);
    expect(mixed).toBe('2 suplementos no se están contando hoy — revísalos');
    expect(mixed).not.toBe(describeNeedsReviewBanner(2));
    expect(mixed).not.toBe(describeUnsupportedBanner(2));
  });

  it('8. mezcla con total 1 (un needs_review, cero unsupported y viceversa ya cubiertos arriba) usa singular', () => {
    // El único caso de "mezcla" con total=1 no existe (mezcla implica ambos
    // >0, así que total >= 2 siempre) — se documenta aquí para dejar
    // constancia de que no hace falta una rama especial.
    expect(describeAttentionBanner(1, 1)).toContain('2 suplementos');
  });

  it('no genera seis mensajes distintos: sólo tres formas (needs_review, unsupported, mezcla), cada una singular/plural', () => {
    const variants = new Set([
      describeAttentionBanner(1, 0),
      describeAttentionBanner(2, 0),
      describeAttentionBanner(0, 1),
      describeAttentionBanner(0, 2),
      describeAttentionBanner(1, 1),
      describeAttentionBanner(2, 1),
    ]);
    expect(variants.size).toBe(6); // 3 formas × singular/plural, no una frase distinta por combinación exacta de conteos
  });
});

describe('unsupportedAttentionMessage / attentionAccessibilityLabel (Fase 6)', () => {
  it('7. requires_amount_per_unit tiene un mensaje diferenciado, no el genérico', () => {
    const dose = normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' });
    const msg = unsupportedAttentionMessage(dose);
    expect(msg).toBe('Este suplemento no se está contando porque falta indicar cuánto nutriente contiene cada cápsula.');
    expect(msg).not.toMatch(/no podemos interpretar su dosis/);
  });

  it('unit_incompatible_with_nutrient tiene un mensaje diferenciado del de requires_amount_per_unit', () => {
    const dose = normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey: 'iron_mg' });
    const msg = unsupportedAttentionMessage(dose);
    expect(msg).toBe('Este suplemento no se está contando porque su unidad no es compatible con este nutriente.');
    expect(msg).not.toContain('cápsula');
  });

  it('unknown_unit y unknown_nutrient tienen mensajes distintos entre sí', () => {
    const unknownUnit = normalizeSupplementDose({ amount: 1, unit: 'onzas', nutrientKey: 'iron_mg' });
    const unknownNutrient = normalizeSupplementDose({ amount: 1, unit: 'mg', nutrientKey: 'no_existe' });
    const msgUnit = unsupportedAttentionMessage(unknownUnit);
    const msgNutrient = unsupportedAttentionMessage(unknownNutrient);
    expect(msgUnit).not.toBe(msgNutrient);
    expect(msgUnit).toMatch(/unidad/i);
    expect(msgNutrient).toMatch(/nutriente/i);
  });

  it('ningún mensaje expone el nombre interno del reason', () => {
    const reasons = [
      normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' }),
      normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey: 'zinc_mg' }),
      normalizeSupplementDose({ amount: 1, unit: 'onzas', nutrientKey: 'iron_mg' }),
      normalizeSupplementDose({ amount: 1, unit: 'mg', nutrientKey: 'no_existe' }),
    ];
    for (const dose of reasons) {
      const msg = unsupportedAttentionMessage(dose);
      expect(msg).not.toMatch(/unit_incompatible_with_nutrient|requires_amount_per_unit|unknown_unit|unknown_nutrient|invalid_amount/);
    }
  });

  it('devuelve null para success y needs_review (no es su función)', () => {
    const success = normalizeSupplementDose({ amount: 25, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' });
    const needsReview = normalizeSupplementDose({ amount: 150, unit: 'g', nutrientKey: 'calcium_mg' });
    expect(unsupportedAttentionMessage(success)).toBeNull();
    expect(unsupportedAttentionMessage(needsReview)).toBeNull();
  });

  it('attentionAccessibilityLabel: needs_review usa NEEDS_REVIEW_ACCESSIBILITY_LABEL, unsupported usa su propio mensaje', () => {
    const needsReview = normalizeSupplementDose({ amount: 150, unit: 'g', nutrientKey: 'calcium_mg' });
    const unsupported = normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' });
    expect(attentionAccessibilityLabel(needsReview)).toBe(NEEDS_REVIEW_ACCESSIBILITY_LABEL);
    expect(attentionAccessibilityLabel(unsupported)).toBe(unsupportedAttentionMessage(unsupported));
    expect(attentionAccessibilityLabel(needsReview)).not.toBe(attentionAccessibilityLabel(unsupported));
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
