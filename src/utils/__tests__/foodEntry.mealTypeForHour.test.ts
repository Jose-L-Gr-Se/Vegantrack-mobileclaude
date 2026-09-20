/**
 * Límites horarios de `mealTypeForHour` (preselección de comida en el
 * resultado de foto-IA — auditoría IA→resultado→guardar). Función pura,
 * sin dependencias de fecha/estado: se prueba con horas explícitas, no con
 * `Date` real ni mocks de reloj.
 */
import { mealTypeForHour } from '@/utils/foodEntry';

describe('mealTypeForHour — límites horarios', () => {
  it('madrugada (0-4) → snack', () => {
    expect(mealTypeForHour(0)).toBe('snack');
    expect(mealTypeForHour(1)).toBe('snack');
    expect(mealTypeForHour(4)).toBe('snack');
  });

  it('límite inferior de breakfast: 4 → snack, 5 → breakfast', () => {
    expect(mealTypeForHour(4)).toBe('snack');
    expect(mealTypeForHour(5)).toBe('breakfast');
  });

  it('breakfast (5-10)', () => {
    expect(mealTypeForHour(5)).toBe('breakfast');
    expect(mealTypeForHour(8)).toBe('breakfast');
    expect(mealTypeForHour(10)).toBe('breakfast');
  });

  it('límite breakfast → lunch: 10 → breakfast, 11 → lunch', () => {
    expect(mealTypeForHour(10)).toBe('breakfast');
    expect(mealTypeForHour(11)).toBe('lunch');
  });

  it('lunch (11-16)', () => {
    expect(mealTypeForHour(11)).toBe('lunch');
    expect(mealTypeForHour(13)).toBe('lunch');
    expect(mealTypeForHour(16)).toBe('lunch');
  });

  it('límite lunch → dinner: 16 → lunch, 17 → dinner', () => {
    expect(mealTypeForHour(16)).toBe('lunch');
    expect(mealTypeForHour(17)).toBe('dinner');
  });

  it('dinner (17-22)', () => {
    expect(mealTypeForHour(17)).toBe('dinner');
    expect(mealTypeForHour(20)).toBe('dinner');
    expect(mealTypeForHour(22)).toBe('dinner');
  });

  it('límite dinner → snack: 22 → dinner, 23 → snack', () => {
    expect(mealTypeForHour(22)).toBe('dinner');
    expect(mealTypeForHour(23)).toBe('snack');
  });

  it('cubre las 24 horas sin huecos: cada hora de 0 a 23 devuelve un MealType válido', () => {
    const valid = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
    for (let h = 0; h < 24; h++) {
      expect(valid.has(mealTypeForHour(h))).toBe(true);
    }
  });
});
