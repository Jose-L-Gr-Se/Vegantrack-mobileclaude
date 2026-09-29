/**
 * Fase 3 del P0 de unidades de suplementos — `formatDosePreview()` y
 * `unsupportedMessageFor()`, las dos funciones puras que
 * `SupplementEditor.tsx` exporta para no atar la lógica de presentación al
 * árbol de React.
 *
 * `@testing-library/react-native`/`renderHook` no son fiables en este
 * entorno (React 19 + RNTL 14 — ver precedente en `proEntitlement.ts`), así
 * que el comportamiento del editor se prueba a este nivel: qué texto
 * produce para cada `SupplementDoseResult` posible, no renderizando el
 * componente. La lógica de "qué unidades se ofrecen" está cubierta aparte
 * en `supplementUnits.compat.test.ts`; aquí sólo la presentación de un
 * resultado ya calculado.
 */
// SupplementEditor.tsx importa @expo/vector-icons, que en este entorno de
// test arrastra expo-font → expo-asset (no instalado a propósito, ver
// nutrition.test.ts). No se renderiza el componente en este fichero —sólo
// se usan sus dos funciones puras exportadas—, así que basta un stub.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
// @/theme → themeStore.ts → @/db/database → expo-sqlite: mismo motivo.
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import { formatDosePreview, unsupportedMessageFor } from '@/components/SupplementEditor';
import { normalizeSupplementDose, type SupplementDoseResult } from '@/utils/supplementUnits';

describe('formatDosePreview · texto de equivalencia', () => {
  it('mcg: "Equivale a 1.000 mcg de Vitamina B12"', () => {
    const dose = normalizeSupplementDose({ amount: 1, unit: 'mg', nutrientKey: 'vitamin_b12_mcg' });
    expect(formatDosePreview(dose, 'Vitamina B12')).toBe('Equivale a 1.000 mcg de Vitamina B12');
  });

  it('mg: "Equivale a 150 mg de Calcio"', () => {
    const dose = normalizeSupplementDose({ amount: 150, unit: 'mg', nutrientKey: 'calcium_mg' });
    expect(formatDosePreview(dose, 'Calcio')).toBe('Equivale a 150 mg de Calcio');
  });

  it('g: "Equivale a 1 g de Omega-3 (DHA/EPA)"', () => {
    const dose = normalizeSupplementDose({ amount: 1000, unit: 'mg', nutrientKey: 'omega3_g' });
    expect(formatDosePreview(dose, 'Omega-3 (DHA/EPA)')).toBe('Equivale a 1 g de Omega-3 (DHA/EPA)');
  });

  it('vitamina D en IU: "Equivale a 25 mcg de Vitamina D"', () => {
    const dose = normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey: 'vitamin_d_mcg' });
    expect(formatDosePreview(dose, 'Vitamina D')).toBe('Equivale a 25 mcg de Vitamina D');
  });

  it('needs_review también muestra el preview (el aviso es un texto aparte)', () => {
    const dose = normalizeSupplementDose({ amount: 150, unit: 'g', nutrientKey: 'calcium_mg' });
    expect(dose.status).toBe('needs_review');
    expect(formatDosePreview(dose, 'Calcio')).toBe('Equivale a 150.000 mg de Calcio');
  });

  it('sin nutriente asociado (recuento): no hay preview', () => {
    const dose = normalizeSupplementDose({ amount: 5, unit: 'g', nutrientKey: null });
    expect(formatDosePreview(dose, '')).toBeNull();
  });

  it('unsupported: no hay preview', () => {
    const dose = normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' });
    expect(formatDosePreview(dose, 'Vitamina B12')).toBeNull();
  });
});

describe('unsupportedMessageFor · mensajes comprensibles, nunca códigos internos', () => {
  it('IU para hierro → "Esta unidad no es compatible con este nutriente."', () => {
    const dose = normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey: 'iron_mg' });
    expect(unsupportedMessageFor(dose)).toBe('Esta unidad no es compatible con este nutriente.');
  });

  it('cápsula con nutrientKey → explica que hace falta la cantidad por unidad', () => {
    const dose = normalizeSupplementDose({ amount: 25, unit: 'cápsula', nutrientKey: 'vitamin_b12_mcg' });
    const msg = unsupportedMessageFor(dose);
    expect(msg).toMatch(/cápsulas? o gotas?/i);
    expect(msg).not.toMatch(/requires_amount_per_unit/);
  });

  it('unidad desconocida → mensaje comprensible', () => {
    const dose = normalizeSupplementDose({ amount: 10, unit: 'onzas', nutrientKey: 'iron_mg' });
    expect(unsupportedMessageFor(dose)).toBe('Esta unidad no se reconoce. Elige una de las opciones disponibles.');
  });

  it('nutriente desconocido → mensaje comprensible, sin romper', () => {
    const dose = normalizeSupplementDose({ amount: 10, unit: 'mg', nutrientKey: 'selenium_mg' });
    expect(unsupportedMessageFor(dose)).toMatch(/nutriente que la app no reconoce/i);
  });

  it('ningún mensaje contiene el nombre interno del motivo (reason) en crudo', () => {
    const reasons: SupplementDoseResult[] = [
      normalizeSupplementDose({ amount: 1000, unit: 'IU', nutrientKey: 'zinc_mg' }),
      normalizeSupplementDose({ amount: 1, unit: 'gota', nutrientKey: 'omega3_g' }),
      normalizeSupplementDose({ amount: 1, unit: 'parsecs', nutrientKey: null }),
      normalizeSupplementDose({ amount: 1, unit: 'mg', nutrientKey: 'no_existe' }),
    ];
    for (const dose of reasons) {
      const msg = unsupportedMessageFor(dose);
      expect(msg).not.toBeNull();
      expect(msg).not.toMatch(/unit_incompatible_with_nutrient|requires_amount_per_unit|unknown_unit|unknown_nutrient|invalid_amount/);
    }
  });

  it('success y needs_review no producen mensaje de rechazo (no bloquean el guardado)', () => {
    const success = normalizeSupplementDose({ amount: 25, unit: 'mcg', nutrientKey: 'vitamin_b12_mcg' });
    const needsReview = normalizeSupplementDose({ amount: 150, unit: 'g', nutrientKey: 'calcium_mg' });
    expect(unsupportedMessageFor(success)).toBeNull();
    expect(unsupportedMessageFor(needsReview)).toBeNull();
  });
});
