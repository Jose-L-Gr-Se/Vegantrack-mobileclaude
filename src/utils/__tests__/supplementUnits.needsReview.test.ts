/**
 * Fase 5 del P0 de unidades de suplementos — `supplementsNeedingReview()`.
 *
 * Es la función que DiaryScreen y ProfileScreen usan tal cual, sin
 * reimplementarla, para decidir el icono por fila. No depende del store: se
 * prueba aquí con fixtures de `Supplement` directos.
 */
import { supplementsNeedingReview } from '@/utils/supplementUnits';
import type { Supplement } from '@/types';

function makeSupplement(over: Partial<Supplement> & { id: string }): Supplement {
  return {
    user_id: 'u1',
    name: 'Suplemento de prueba',
    nutrient_key: null,
    emoji: '💊',
    dose_amount: 1,
    dose_unit: 'mg',
    frequency: 'daily',
    is_active: true,
    sort_order: 0,
    created_at: '',
    ...over,
  };
}

describe('supplementsNeedingReview', () => {
  it('1. lista vacía → []', () => {
    expect(supplementsNeedingReview([])).toEqual([]);
  });

  it('2. todos success → []', () => {
    const supplements = [
      makeSupplement({ id: 's1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' }),
      makeSupplement({ id: 's2', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'mg' }),
    ];
    expect(supplementsNeedingReview(supplements)).toEqual([]);
  });

  it('3. mezcla success + needs_review → devuelve exactamente los needs_review', () => {
    const ok = makeSupplement({ id: 's-ok', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' });
    const review = makeSupplement({ id: 's-review', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' });
    const result = supplementsNeedingReview([ok, review]);
    expect(result).toEqual([review]);
  });

  it('4. el resultado es independiente de si el suplemento fue tomado hoy', () => {
    // La función no recibe ni consulta ningún estado de "tomado" — Supplement
    // no tiene ese concepto (vive aparte, en takenToday del store). Da igual
    // cuántas veces se llame: mismo resultado siempre, para el mismo dato.
    const review = makeSupplement({ id: 's1', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' });
    const first = supplementsNeedingReview([review]);
    const second = supplementsNeedingReview([review]);
    expect(first).toEqual(second);
    expect(first).toEqual([review]);
  });

  it('5. suplemento sin nutrient_key → no aparece, aunque la cantidad sea grande', () => {
    const noNutrient = makeSupplement({ id: 's1', nutrient_key: null, dose_amount: 999_999, dose_unit: 'g' });
    expect(supplementsNeedingReview([noNutrient])).toEqual([]);
  });

  it('6. fixture real: calcio 150 g → aparece como needs_review', () => {
    // La fila real de producción que originó todo este P0.
    const calcium = makeSupplement({ id: 's-calcio', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' });
    expect(supplementsNeedingReview([calcium])).toEqual([calcium]);
  });

  it('11. regresión: calcio 150 g configurado pero nunca tomado sigue apareciendo (Diary/Profile evalúan todo, no sólo lo tomado hoy)', () => {
    // Este fixture no tiene ningún campo de "tomado" — precisamente porque
    // la función no debe necesitarlo. Representa el mismo suplemento que
    // vería un usuario en su lista aunque hoy no lo haya marcado.
    const calciumNeverTaken = makeSupplement({
      id: 's-calcio-2', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g', is_active: true,
    });
    expect(supplementsNeedingReview([calciumNeverTaken])).toEqual([calciumNeverTaken]);
  });

  it('nutriente desconocido (dato heredado sin CHECK constraint) no rompe la función y no se marca needs_review', () => {
    const garbage = makeSupplement({ id: 's1', nutrient_key: 'no_existe' as Supplement['nutrient_key'], dose_amount: 10, dose_unit: 'mg' });
    expect(() => supplementsNeedingReview([garbage])).not.toThrow();
    expect(supplementsNeedingReview([garbage])).toEqual([]);
  });

  it('preserva el orden original de la lista', () => {
    const a = makeSupplement({ id: 'a', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' });
    const b = makeSupplement({ id: 'b', nutrient_key: 'zinc_mg', dose_amount: 93_402, dose_unit: 'mg' });
    const c = makeSupplement({ id: 'c', nutrient_key: 'iron_mg', dose_amount: 14, dose_unit: 'mg' }); // success, no aparece
    expect(supplementsNeedingReview([a, b, c]).map((s) => s.id)).toEqual(['a', 'b']);
  });
});
