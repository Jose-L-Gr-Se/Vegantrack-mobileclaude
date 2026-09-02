/**
 * Fase 6 del P0 de unidades de suplementos — `supplementsNeedingAttention()`.
 *
 * Cubre needs_review + unsupported combinados. `supplementsNeedingReview()`
 * (Fase 5) sigue probada aparte en `supplementUnits.needsReview.test.ts` —
 * ahora es una proyección de esta función, no una implementación distinta.
 */
import { supplementsNeedingAttention } from '@/utils/supplementUnits';
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

describe('supplementsNeedingAttention', () => {
  it('1. B12 25 cápsula + nutrient_key → unsupported / requires_amount_per_unit', () => {
    const b12Capsula = makeSupplement({
      id: 's-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula',
    });
    const result = supplementsNeedingAttention([b12Capsula]);
    expect(result).toHaveLength(1);
    expect(result[0].supplement.id).toBe('s-b12');
    expect(result[0].dose.status).toBe('unsupported');
    if (result[0].dose.status === 'unsupported') {
      expect(result[0].dose.reason).toBe('requires_amount_per_unit');
    }
  });

  it('2. mezcla success + needs_review + unsupported → devuelve exactamente needs_review y unsupported, con su status completo', () => {
    const ok = makeSupplement({ id: 's-ok', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' });
    const review = makeSupplement({ id: 's-review', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' });
    const unsupported = makeSupplement({ id: 's-unsupported', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula' });

    const result = supplementsNeedingAttention([ok, review, unsupported]);
    const byId = Object.fromEntries(result.map((a) => [a.supplement.id, a]));

    expect(Object.keys(byId).sort()).toEqual(['s-review', 's-unsupported']);
    expect(byId['s-review'].dose.status).toBe('needs_review');
    expect(byId['s-unsupported'].dose.status).toBe('unsupported');
  });

  it('3. suplemento sin nutrient_key no aparece, aunque su unidad/cantidad serían unsupported con un nutriente', () => {
    // cápsula sin nutrient_key es válida (recuento puro) — no le "falta" nada.
    const countOnly = makeSupplement({ id: 's-null', nutrient_key: null, dose_amount: 1, dose_unit: 'cápsula' });
    expect(supplementsNeedingAttention([countOnly])).toEqual([]);
  });

  it('4. unsupported NO tomado hoy sigue apareciendo (la función no recibe ni consulta takenToday)', () => {
    // Mismo criterio que supplementsNeedingReview(): es una propiedad de la
    // configuración del suplemento, no de un evento de toma. No hay ningún
    // campo de "tomado" en el fixture — precisamente porque no debería hacer falta.
    const b12Capsula = makeSupplement({
      id: 's-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula',
    });
    const result = supplementsNeedingAttention([b12Capsula]);
    expect(result).toHaveLength(1);
    expect(result[0].dose.status).toBe('unsupported');
  });

  it('9. regresión con las 34 filas reales de producción: el único unsupported activo sigue siendo B12 + cápsula', () => {
    // Fixtures reales de la auditoría de solo lectura (Fase 6): 30 success,
    // 3 needs_review, 1 unsupported — y ese unsupported es exactamente
    // B12 · 25 cápsula · vitamin_b12_mcg, activo y tomado.
    const realRows: Supplement[] = [
      makeSupplement({ id: 'r1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 1000, dose_unit: 'μg' }),
      makeSupplement({ id: 'r2', nutrient_key: 'vitamin_d_mcg', dose_amount: 100, dose_unit: 'μg' }),
      makeSupplement({ id: 'r3', nutrient_key: 'omega3_g', dose_amount: 1, dose_unit: 'g' }),
      makeSupplement({ id: 'r4', nutrient_key: null, dose_amount: 5, dose_unit: 'g' }),
      makeSupplement({ id: 'r5', nutrient_key: null, dose_amount: 400, dose_unit: 'mg' }),
      makeSupplement({ id: 'r6', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' }),
      makeSupplement({ id: 'r7', nutrient_key: 'vitamin_d_mcg', dose_amount: 25, dose_unit: 'mcg' }),
      makeSupplement({ id: 'r8', nutrient_key: 'zinc_mg', dose_amount: 93_402, dose_unit: 'mg' }), // needs_review
      makeSupplement({ id: 'r9', nutrient_key: 'omega3_g', dose_amount: 46_856, dose_unit: 'mg' }), // needs_review
      makeSupplement({ id: 'r10', nutrient_key: null, dose_amount: 1, dose_unit: 'mg' }),
      makeSupplement({ id: 'r11', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula' }), // unsupported
      makeSupplement({ id: 'r12', nutrient_key: 'omega3_g', dose_amount: 0.5, dose_unit: 'g' }),
      makeSupplement({ id: 'r13', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' }), // needs_review
    ];

    const attention = supplementsNeedingAttention(realRows);
    const unsupported = attention.filter((a) => a.dose.status === 'unsupported');
    const needsReview = attention.filter((a) => a.dose.status === 'needs_review');

    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].supplement.id).toBe('r11');
    expect(unsupported[0].supplement.nutrient_key).toBe('vitamin_b12_mcg');
    expect(unsupported[0].supplement.dose_unit).toBe('cápsula');
    if (unsupported[0].dose.status === 'unsupported') {
      expect(unsupported[0].dose.reason).toBe('requires_amount_per_unit');
    }

    expect(needsReview.map((a) => a.supplement.id).sort()).toEqual(['r13', 'r8', 'r9'].sort());
  });
});
