/**
 * Atribución nutricional comida vs. suplementación — `microAttribution.ts`.
 * Pura: sólo describe de dónde viene lo ya conocido; nunca calcula ni cambia
 * un total. Mismo mock de dependencias que `nutritionInsight.test.ts`
 * (`nutrition.ts` carga `@/lib/nutrientOverrides` → `@/db/database`).
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import {
  attributeMicroIntake,
  describeMicroAttribution,
  type AttributionInput,
} from '@/utils/microAttribution';
import { resolveMicroDisplay } from '@/utils/nutrition';
import type { MicroAggregate } from '@/types';

/** Día "limpio": comida totalmente conocida (cobertura 1) y ningún suplemento por revisar. */
function day(over: Partial<AttributionInput> = {}): AttributionInput {
  return {
    knownFood: 0,
    supplement: 0,
    coverageByGrams: 1,
    hasEntries: true,
    supplementUnresolved: false,
    ...over,
  };
}

describe('atribución de un día — casos con dato completo', () => {
  it('1. 100 % procedente de alimentos', () => {
    const a = attributeMicroIntake([day({ knownFood: 4 })]);
    expect(a.source).toBe('food');
    expect(a.shares).toEqual({ food: 1, supplement: 0 });
    expect(a.total).toBe(4);
    expect(describeMicroAttribution(a, 'mcg')?.headline).toBe('Todo el aporte registrado procede de alimentos');
  });

  it('2. 100 % procedente de suplemento — sin comida registrada', () => {
    const a = attributeMicroIntake([day({ hasEntries: false, coverageByGrams: 0, supplement: 25 })]);
    expect(a.source).toBe('supplement');
    expect(a.shares).toEqual({ food: 0, supplement: 1 });
    expect(a.food).toBe(0);
    expect(a.total).toBe(25);
    expect(describeMicroAttribution(a, 'mcg')?.headline).toBe('Todo el aporte registrado procede de suplementos');
  });

  it('2b. 100 % procedente de suplemento — con comida registrada cuyo aporte conocido es 0', () => {
    const a = attributeMicroIntake([day({ knownFood: 0, supplement: 25 })]);
    expect(a.source).toBe('supplement');
    expect(a.shares).toEqual({ food: 0, supplement: 1 });
  });

  it('3. mezcla comida + suplemento: 4,05 + 0,9 = 4,95 mcg → 82 % alimentos · 18 % suplementos', () => {
    const a = attributeMicroIntake([day({ knownFood: 4.05, supplement: 0.9 })]);
    expect(a.source).toBe('mixed');
    expect(a.food).toBeCloseTo(4.05, 10);
    expect(a.supplement).toBeCloseTo(0.9, 10);
    expect(a.total).toBeCloseTo(4.95, 10);
    expect(a.shares!.food).toBeCloseTo(0.818, 3);
    expect(a.shares!.supplement).toBeCloseTo(0.182, 3);

    const copy = describeMicroAttribution(a, 'mcg')!;
    expect(copy.headline).toBe('82 % alimentos · 18 % suplementos');
    expect(copy.detail).toBe('Aporte conocido: 4,95 mcg');
  });

  it('los porcentajes mostrados siempre suman 100 (nunca 99 ni 101 por redondeo independiente)', () => {
    // 1/8 y 7/8 (12,5 % y 87,5 %) redondeados por separado darían 13 + 88 = 101.
    for (const [food, supp] of [[1, 2], [1, 5], [7, 1], [1, 7], [2, 3]] as const) {
      const copy = describeMicroAttribution(attributeMicroIntake([day({ knownFood: food, supplement: supp })]), 'mg')!;
      const [f, s] = copy.headline.match(/\d+/g)!.map(Number);
      expect(f + s).toBe(100);
    }
  });
});

describe('atribución — datos parcialmente desconocidos (nunca porcentajes falsamente precisos)', () => {
  it('4a. comida con cobertura parcial: se conservan las cifras conocidas, pero NO hay reparto', () => {
    const a = attributeMicroIntake([day({ knownFood: 3, supplement: 2, coverageByGrams: 0.5 })]);
    expect(a.shares).toBeNull();
    expect(a.food).toBe(3); // cota inferior: no se descarta
    expect(a.supplement).toBe(2);
    expect(a.total).toBe(5);
    expect(a.foodFullyKnown).toBe(false);
    expect(a.supplementFullyKnown).toBe(true);

    const copy = describeMicroAttribution(a, 'mcg')!;
    expect(copy.headline).toBe('Aporte conocido: 3 mcg de alimentos · 2 mcg de suplementos');
    expect(copy.detail).toBe('No calculamos porcentajes: parte de tus alimentos no tiene dato de este nutriente.');
  });

  it('4b. suplemento con dosis sin normalizar: "supplement: 0" NO se presenta como 100 % alimentos', () => {
    const a = attributeMicroIntake([day({ knownFood: 4, supplement: 0, supplementUnresolved: true })]);
    expect(a.shares).toBeNull();
    expect(a.supplementFullyKnown).toBe(false);

    const copy = describeMicroAttribution(a, 'mcg')!;
    expect(copy.headline).toBe('Aporte conocido: 4 mcg de alimentos');
    expect(copy.detail).toBe('No calculamos porcentajes: hay suplementos con dosis por revisar.');
  });

  it('4c. ambas incertidumbres a la vez se explican juntas', () => {
    const a = attributeMicroIntake([day({ knownFood: 1, supplement: 1, coverageByGrams: 0.2, supplementUnresolved: true })]);
    expect(a.shares).toBeNull();
    expect(describeMicroAttribution(a, 'mg')!.detail).toBe(
      'No calculamos porcentajes: parte de tus alimentos no tiene dato de este nutriente y hay suplementos con dosis por revisar.'
    );
  });

  it('4d. sólo comida parcial y sin suplemento: source "food" (lo conocido) pero sin afirmar un 100 %', () => {
    const a = attributeMicroIntake([day({ knownFood: 2, coverageByGrams: 0.4 })]);
    expect(a.source).toBe('food');
    expect(a.shares).toBeNull();
  });
});

describe('atribución — ningún dato', () => {
  it('5. un día sin comida ni suplemento no describe nada (nunca un 0 % / 100 % inventado)', () => {
    const a = attributeMicroIntake([day({ hasEntries: false, coverageByGrams: 0 })]);
    expect(a.source).toBe('none');
    expect(a.days).toBe(0);
    expect(a.total).toBe(0);
    expect(a.shares).toBeNull();
    expect(describeMicroAttribution(a, 'mcg')).toBeNull();
  });

  it('5b. lista vacía: igual que sin datos', () => {
    const a = attributeMicroIntake([]);
    expect(a.source).toBe('none');
    expect(describeMicroAttribution(a, 'mcg')).toBeNull();
  });

  it('5c. sólo una toma sin normalizar y nada más: no hay aporte conocido que describir', () => {
    const a = attributeMicroIntake([day({ hasEntries: false, coverageByGrams: 0, supplementUnresolved: true })]);
    expect(a.source).toBe('none');
    expect(describeMicroAttribution(a, 'mcg')).toBeNull();
  });
});

describe('atribución — no cambia ningún total existente', () => {
  it('6. food + supplement es exactamente el `known` de resolveMicroDisplay (mismos números que ya se mostraban)', () => {
    const agg: MicroAggregate = {
      value: 4.05, knownEntries: 2, totalEntries: 2, coverage: 1,
      knownGrams: 250, totalGrams: 250, coverageByGrams: 1, hasEntries: true,
    };
    const display = resolveMicroDisplay(agg, 0.9, 2.4);

    const a = attributeMicroIntake([{ ...display, supplementUnresolved: false }]);

    expect(a.food).toBe(display.knownFood);
    expect(a.supplement).toBe(display.supplement);
    expect(a.total).toBe(display.known); // exacto, no "cercano"
  });

  it('6b. para un único día, total === knownFood + supplement de forma exacta', () => {
    for (const [food, supp] of [[0, 0], [4, 0], [0, 25], [4.05, 0.9], [1234.5678, 0.0001]] as const) {
      const a = attributeMicroIntake([day({ knownFood: food, supplement: supp, hasEntries: food > 0 || supp > 0 })]);
      expect(a.total).toBe(food + supp);
    }
  });

  it('6c. en un periodo, total es la media de `value` (comida + suplemento) sobre los mismos días que ya promedia la pantalla', () => {
    const days = [
      day({ knownFood: 4, supplement: 0 }),
      day({ knownFood: 0, supplement: 10, hasEntries: false, coverageByGrams: 0 }),
      day({ hasEntries: false, coverageByGrams: 0 }), // sin datos: fuera del promedio, como en la pantalla
    ];
    const screenAverage = ((4 + 0) + (0 + 10)) / 2; // media de `value` sobre los 2 días con datos
    expect(attributeMicroIntake(days).total).toBe(screenAverage);
  });
});

describe('atribución de un periodo', () => {
  it('promedia sólo los días con datos y reparte sobre las sumas', () => {
    const a = attributeMicroIntake([
      day({ knownFood: 4 }),
      day({ hasEntries: false, coverageByGrams: 0, supplement: 10 }),
      day({ hasEntries: false, coverageByGrams: 0 }),
    ]);
    expect(a.days).toBe(2);
    expect(a.food).toBe(2);
    expect(a.supplement).toBe(5);
    expect(a.shares!.food).toBeCloseTo(4 / 14, 10);
    expect(a.shares!.supplement).toBeCloseTo(10 / 14, 10);
    expect(describeMicroAttribution(a, 'mg')!.detail).toBe('Media diaria conocida: 7 mg');
  });

  it('un solo día con comida parcial en el periodo impide afirmar el reparto de TODO el periodo', () => {
    const a = attributeMicroIntake([day({ knownFood: 4 }), day({ knownFood: 1, coverageByGrams: 0.3 }), day({ knownFood: 4 })]);
    expect(a.shares).toBeNull();
    expect(a.foodFullyKnown).toBe(false);
  });

  it('una toma sin normalizar en un día EXCLUIDO del promedio también impide el reparto', () => {
    const a = attributeMicroIntake([
      day({ knownFood: 4 }),
      day({ hasEntries: false, coverageByGrams: 0, supplementUnresolved: true }), // sin aporte conocido, pero hubo una toma
    ]);
    expect(a.days).toBe(1);
    expect(a.shares).toBeNull();
    expect(a.supplementFullyKnown).toBe(false);
  });
});
