/**
 * Fase 2 del P0 de unidades de suplementos — integración de
 * `normalizeSupplementDose()` en `supplementStore.ts`.
 *
 * `getTodayContributions()`/`getTodayContributionDetails()` son getters
 * puros sobre el estado del store (no llaman a Supabase), así que estos
 * tests fijan `supplements`/`takenToday` directamente con `setState()` y
 * comprueban lo que devuelven — sin necesidad de simular red.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

import { useSupplementStore } from '@/stores/supplementStore';
import { describeAttentionBanner, describeNeedsReviewBanner } from '@/utils/supplementDoseCopy';
import type { Supplement, SupplementNutrientKey } from '@/types';

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

/** Fija supplements + takenToday (todos los suplementos pasados se marcan tomados hoy, salvo que se pase `taken: false`). */
function setSupplements(entries: (Partial<Supplement> & { id: string; taken?: boolean })[]) {
  const supplements: Supplement[] = [];
  const takenToday: Record<string, string> = {};
  for (const { taken, ...s } of entries) {
    supplements.push(makeSupplement(s));
    if (taken !== false) takenToday[s.id] = `log-${s.id}`;
  }
  useSupplementStore.setState({ supplements, takenToday });
}

beforeEach(() => {
  useSupplementStore.setState({ supplements: [], takenToday: {}, loading: false });
});

describe('getTodayContributions() · casos del encargo', () => {
  it('B12 1000 mcg → contabiliza 1000 mcg', () => {
    setSupplements([{ id: 's1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 1000, dose_unit: 'mcg' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ vitamin_b12_mcg: 1000 });
  });

  it('B12 1 mg → contabiliza 1000 mcg (conversión de masa, no el número crudo)', () => {
    setSupplements([{ id: 's1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 1, dose_unit: 'mg' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ vitamin_b12_mcg: 1000 });
  });

  it('B12 1 g → NO contabiliza (1 000 000 mcg supera la plausibilidad, needs_review)', () => {
    setSupplements([{ id: 's1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 1, dose_unit: 'g' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});

    const details = useSupplementStore.getState().getTodayContributionDetails();
    expect(details).toHaveLength(1);
    expect(details[0].dose.status).toBe('needs_review');
    if (details[0].dose.status === 'needs_review') {
      expect(details[0].dose.canonicalAmount).toBeCloseTo(1_000_000, 6);
      expect(details[0].dose.canonicalUnit).toBe('mcg');
    }
  });

  it('vitamina D 25 mcg → contabiliza 25 mcg', () => {
    setSupplements([{ id: 's1', nutrient_key: 'vitamin_d_mcg', dose_amount: 25, dose_unit: 'mcg' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ vitamin_d_mcg: 25 });
  });

  it('vitamina D 1000 IU → contabiliza 25 mcg (NIH ODS: 1 mcg = 40 IU)', () => {
    setSupplements([{ id: 's1', nutrient_key: 'vitamin_d_mcg', dose_amount: 1000, dose_unit: 'IU' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ vitamin_d_mcg: 25 });
  });

  it('calcio 150 mg → contabiliza 150 mg', () => {
    setSupplements([{ id: 's1', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'mg' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ calcium_mg: 150 });
  });

  it('calcio 150 g (fila real de producción) → NO contabiliza 150 g como calcio válido; needs_review', () => {
    setSupplements([{ id: 's1', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g' }]);
    // El hallazgo central de la auditoría: sin esta corrección se habría
    // sumado 150 000 mg de calcio silenciosamente.
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});

    const details = useSupplementStore.getState().getTodayContributionDetails();
    expect(details[0].dose.status).toBe('needs_review');
    if (details[0].dose.status === 'needs_review') {
      expect(details[0].dose.canonicalAmount).toBeCloseTo(150_000, 6);
    }
  });

  it('omega-3 1 g → contabiliza 1 g', () => {
    setSupplements([{ id: 's1', nutrient_key: 'omega3_g', dose_amount: 1, dose_unit: 'g' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ omega3_g: 1 });
  });

  it('unidad desconocida → no contabiliza', () => {
    setSupplements([{ id: 's1', nutrient_key: 'iron_mg', dose_amount: 10, dose_unit: 'onzas' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});
    expect(useSupplementStore.getState().getTodayContributionDetails()[0].dose.status).toBe('unsupported');
  });

  it('nutriente desconocido (dato real: nutrient_key sin CHECK constraint en Supabase) → no contabiliza', () => {
    setSupplements([{ id: 's1', nutrient_key: 'selenium_mg' as SupplementNutrientKey, dose_amount: 55, dose_unit: 'mcg' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});
    const detail = useSupplementStore.getState().getTodayContributionDetails()[0];
    expect(detail.dose.status).toBe('unsupported');
    if (detail.dose.status === 'unsupported') expect(detail.dose.reason).toBe('unknown_nutrient');
  });

  it('cápsula con nutrientKey → no contabiliza mientras no exista amount_per_unit (fila real: B12 activo, "25 cápsula")', () => {
    setSupplements([{ id: 's1', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});
    const detail = useSupplementStore.getState().getTodayContributionDetails()[0];
    expect(detail.dose.status).toBe('unsupported');
    if (detail.dose.status === 'unsupported') expect(detail.dose.reason).toBe('requires_amount_per_unit');
  });

  it('gota con nutrientKey → no contabiliza mientras no exista amount_per_unit', () => {
    setSupplements([{ id: 's1', nutrient_key: 'omega3_g', dose_amount: 5, dose_unit: 'gota' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});
  });
});

describe('getTodayContributions() · comportamiento preexistente que no debe romperse', () => {
  it('nutrient_key null (recuento, p. ej. Creatina) sigue sin contabilizar nada — igual que antes de esta fase', () => {
    setSupplements([{ id: 's1', nutrient_key: null, dose_amount: 5, dose_unit: 'g' }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});
    expect(useSupplementStore.getState().getTodayContributionDetails()).toEqual([]);
  });

  it('suplemento no tomado hoy no contabiliza aunque tenga nutrient_key', () => {
    setSupplements([{ id: 's1', nutrient_key: 'iron_mg', dose_amount: 14, dose_unit: 'mg', taken: false }]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({});
  });

  it('varios suplementos del mismo nutriente se suman (todos success)', () => {
    setSupplements([
      { id: 's1', nutrient_key: 'iron_mg', dose_amount: 14, dose_unit: 'mg' },
      { id: 's2', nutrient_key: 'iron_mg', dose_amount: 4000, dose_unit: 'mcg' }, // = 4 mg
    ]);
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ iron_mg: 18 });
  });
});

describe('getTodayContributionDetails() · distingue success / needs_review / unsupported', () => {
  it('un mismo día puede tener las tres puertas a la vez, cada una con su propio nutriente', () => {
    setSupplements([
      { id: 's-ok', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg' }, // success
      { id: 's-review', nutrient_key: 'zinc_mg', dose_amount: 93_402, dose_unit: 'mg' }, // needs_review (fila real "hsfflq")
      { id: 's-unsupported', nutrient_key: 'omega3_g', dose_amount: 1, dose_unit: 'cápsula' }, // unsupported
    ]);

    const details = useSupplementStore.getState().getTodayContributionDetails();
    const byId = Object.fromEntries(details.map((d) => [d.supplementId, d]));

    expect(byId['s-ok'].dose.status).toBe('success');
    expect(byId['s-review'].dose.status).toBe('needs_review');
    expect(byId['s-unsupported'].dose.status).toBe('unsupported');

    // Sólo la 'success' entra en el mapa agregado.
    expect(useSupplementStore.getState().getTodayContributions()).toEqual({ vitamin_b12_mcg: 25 });
  });

  it('needs_review conserva canonicalAmount/canonicalUnit/reviewReason — no se pierde la información', () => {
    setSupplements([{ id: 's1', nutrient_key: 'omega3_g', dose_amount: 46_856, dose_unit: 'mg' }]); // fila real (inactiva en producción)
    const detail = useSupplementStore.getState().getTodayContributionDetails()[0];
    expect(detail.dose.status).toBe('needs_review');
    if (detail.dose.status === 'needs_review') {
      expect(detail.dose.canonicalAmount).toBeCloseTo(46.856, 6);
      expect(detail.dose.canonicalUnit).toBe('g');
      expect(typeof detail.dose.reviewReason).toBe('string');
      expect(detail.dose.reviewReason.length).toBeGreaterThan(0);
    }
  });

  it('unsupported nunca lleva canonicalAmount — needs_review y unsupported tienen formas disjuntas', () => {
    setSupplements([{ id: 's1', nutrient_key: 'iron_mg', dose_amount: 1, dose_unit: 'onzas' }]);
    const detail = useSupplementStore.getState().getTodayContributionDetails()[0];
    expect(detail.dose.status).toBe('unsupported');
    expect('canonicalAmount' in detail.dose).toBe(false);
  });
});

describe('Fase 5 — aviso agregado de Dashboard (getTodayContributionDetails + describeNeedsReviewBanner)', () => {
  it('12. calcio 150 g configurado pero NO tomado hoy → no cuenta para el banner de hoy', () => {
    setSupplements([{ id: 's-calcio', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g', taken: false }]);
    const todayNeedsReview = useSupplementStore
      .getState()
      .getTodayContributionDetails()
      .filter((d) => d.dose.status === 'needs_review');
    expect(todayNeedsReview).toEqual([]);
    expect(describeNeedsReviewBanner(todayNeedsReview.length)).toBeNull();
  });

  it('13. calcio 150 g configurado y SÍ tomado hoy → aparece y cuenta 1 para el banner', () => {
    setSupplements([{ id: 's-calcio', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g', taken: true }]);
    const todayNeedsReview = useSupplementStore
      .getState()
      .getTodayContributionDetails()
      .filter((d) => d.dose.status === 'needs_review');
    expect(todayNeedsReview).toHaveLength(1);
    expect(todayNeedsReview[0].supplementId).toBe('s-calcio');
    expect(describeNeedsReviewBanner(todayNeedsReview.length)).toBe(
      '1 suplemento no se está contando hoy — revisa su unidad'
    );
  });

  it('un suplemento needs_review no tomado no afecta a otro sí tomado el mismo día (recuento exacto, no contamina)', () => {
    setSupplements([
      { id: 's-no-tomado', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g', taken: false },
      { id: 's-tomado', nutrient_key: 'zinc_mg', dose_amount: 93_402, dose_unit: 'mg', taken: true },
    ]);
    const todayNeedsReview = useSupplementStore
      .getState()
      .getTodayContributionDetails()
      .filter((d) => d.dose.status === 'needs_review');
    expect(todayNeedsReview.map((d) => d.supplementId)).toEqual(['s-tomado']);
    expect(describeNeedsReviewBanner(todayNeedsReview.length)).toBe(
      '1 suplemento no se está contando hoy — revisa su unidad'
    );
  });
});

describe('Fase 6 — aviso agregado de Dashboard con unsupported (getTodayContributionDetails + describeAttentionBanner)', () => {
  it('5. B12 + cápsula (unsupported) NO tomado hoy → no cuenta para el banner de hoy', () => {
    setSupplements([{ id: 's-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula', taken: false }]);
    const today = useSupplementStore.getState().getTodayContributionDetails();
    const unsupportedToday = today.filter((d) => d.dose.status === 'unsupported');
    expect(unsupportedToday).toEqual([]);
    expect(describeAttentionBanner(0, unsupportedToday.length)).toBeNull();
  });

  it('5. B12 + cápsula (unsupported) SÍ tomado hoy → aparece y cuenta 1 para el banner', () => {
    setSupplements([{ id: 's-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula', taken: true }]);
    const today = useSupplementStore.getState().getTodayContributionDetails();
    const unsupportedToday = today.filter((d) => d.dose.status === 'unsupported');
    expect(unsupportedToday).toHaveLength(1);
    expect(unsupportedToday[0].supplementId).toBe('s-b12');
    expect(describeAttentionBanner(0, unsupportedToday.length)).toBe(
      '1 suplemento no se está contando hoy — revisa su dosis'
    );
  });

  it('8. needs_review + unsupported tomados el mismo día → un único banner agregado, ninguno de los dos por separado', () => {
    setSupplements([
      { id: 's-calcio', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g', taken: true }, // needs_review
      { id: 's-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula', taken: true }, // unsupported
    ]);
    const today = useSupplementStore.getState().getTodayContributionDetails();
    const needsReviewToday = today.filter((d) => d.dose.status === 'needs_review').length;
    const unsupportedToday = today.filter((d) => d.dose.status === 'unsupported').length;

    expect(needsReviewToday).toBe(1);
    expect(unsupportedToday).toBe(1);

    const banner = describeAttentionBanner(needsReviewToday, unsupportedToday);
    expect(banner).toBe('2 suplementos no se están contando hoy — revísalos');
    expect(banner).not.toBe(describeNeedsReviewBanner(2));
  });

  it('un suplemento unsupported no contamina el recuento de otro needs_review no tomado el mismo día', () => {
    setSupplements([
      { id: 's-calcio', nutrient_key: 'calcium_mg', dose_amount: 150, dose_unit: 'g', taken: false }, // needs_review, no tomado
      { id: 's-b12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'cápsula', taken: true }, // unsupported, tomado
    ]);
    const today = useSupplementStore.getState().getTodayContributionDetails();
    const needsReviewToday = today.filter((d) => d.dose.status === 'needs_review').length;
    const unsupportedToday = today.filter((d) => d.dose.status === 'unsupported').length;

    expect(needsReviewToday).toBe(0);
    expect(unsupportedToday).toBe(1);
    expect(describeAttentionBanner(needsReviewToday, unsupportedToday)).toBe(
      '1 suplemento no se está contando hoy — revisa su dosis'
    );
  });
});
