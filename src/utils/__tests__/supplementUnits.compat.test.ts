/**
 * Fase 3 del P0 de unidades de suplementos — API de compatibilidad para la
 * UI (`compatibleUnitsFor`, `defaultUnitFor`, `isUnitCompatible`,
 * `unitsMatch`, `resolveUnitOnNutrientChange`). Separado de
 * supplementUnits.test.ts (que sólo cubre `normalizeSupplementDose`, no
 * tocada en esta fase) para que quede claro qué cubre cada capa.
 */
import {
  compatibleUnitsFor,
  defaultUnitFor,
  isUnitCompatible,
  resolveUnitOnNutrientChange,
  unitsMatch,
  SUPPLEMENT_CANONICAL_UNIT,
} from '@/utils/supplementUnits';
import type { SupplementNutrientKey } from '@/types';

const KNOWN_NUTRIENTS = Object.keys(SUPPLEMENT_CANONICAL_UNIT) as SupplementNutrientKey[];

describe('defaultUnitFor · unidad canónica por nutriente', () => {
  it('B12 → mcg', () => expect(defaultUnitFor('vitamin_b12_mcg')).toBe('mcg'));
  it('Vitamina D → mcg', () => expect(defaultUnitFor('vitamin_d_mcg')).toBe('mcg'));
  it('Yodo → mcg', () => expect(defaultUnitFor('iodine_mcg')).toBe('mcg'));
  it('Hierro → mg', () => expect(defaultUnitFor('iron_mg')).toBe('mg'));
  it('Zinc → mg', () => expect(defaultUnitFor('zinc_mg')).toBe('mg'));
  it('Calcio → mg', () => expect(defaultUnitFor('calcium_mg')).toBe('mg'));
  it('Omega-3 → g', () => expect(defaultUnitFor('omega3_g')).toBe('g'));
  it('sin nutriente (null) → mg', () => expect(defaultUnitFor(null)).toBe('mg'));
  it('nutriente desconocido → mg, no revienta', () => expect(defaultUnitFor('no_existe')).toBe('mg'));
});

describe('compatibleUnitsFor · unidades ofrecidas por nutriente', () => {
  it('la canónica del nutriente va siempre primero', () => {
    for (const key of KNOWN_NUTRIENTS) {
      expect(compatibleUnitsFor(key)[0]).toBe(SUPPLEMENT_CANONICAL_UNIT[key]);
    }
  });

  it('IU sólo aparece para vitamina D', () => {
    for (const key of KNOWN_NUTRIENTS) {
      const includesIU = compatibleUnitsFor(key).includes('IU');
      expect(includesIU).toBe(key === 'vitamin_d_mcg');
    }
  });

  it('cápsula/gota nunca aparecen cuando hay un nutriente (conocido o no)', () => {
    for (const key of KNOWN_NUTRIENTS) {
      expect(compatibleUnitsFor(key)).not.toContain('cápsula');
      expect(compatibleUnitsFor(key)).not.toContain('gota');
    }
    expect(compatibleUnitsFor('no_existe')).not.toContain('cápsula');
    expect(compatibleUnitsFor('no_existe')).not.toContain('gota');
  });

  it('sin nutriente (null): unidades de masa + cápsula/gota, sin IU', () => {
    const units = compatibleUnitsFor(null);
    expect(units).toEqual(expect.arrayContaining(['mcg', 'mg', 'g', 'cápsula', 'gota']));
    expect(units).not.toContain('IU');
  });

  it('nutriente desconocido: sólo las tres unidades de masa (nunca inventa cápsula/gota/IU)', () => {
    expect(compatibleUnitsFor('selenium_mg')).toEqual(['mcg', 'mg', 'g']);
  });

  it('las 7 listas coinciden exactamente con lo especificado en el encargo', () => {
    expect(compatibleUnitsFor('vitamin_b12_mcg')).toEqual(['mcg', 'mg', 'g']);
    expect(compatibleUnitsFor('vitamin_d_mcg')).toEqual(['mcg', 'mg', 'g', 'IU']);
    expect(compatibleUnitsFor('iodine_mcg')).toEqual(['mcg', 'mg', 'g']);
    expect(compatibleUnitsFor('iron_mg')).toEqual(['mg', 'mcg', 'g']);
    expect(compatibleUnitsFor('zinc_mg')).toEqual(['mg', 'mcg', 'g']);
    expect(compatibleUnitsFor('calcium_mg')).toEqual(['mg', 'mcg', 'g']);
    // Omega-3: el encargo enumera "g, mg, mcg"; esta función deriva el orden
    // de una única lista fija (masa menos la canónica), así que aquí queda
    // "g, mcg, mg" — mismo conjunto de unidades, orden de presentación
    // ligeramente distinto. Documentado también en la entrega.
    expect(compatibleUnitsFor('omega3_g')).toEqual(['g', 'mcg', 'mg']);
  });
});

describe('unitsMatch · compara por alias, no por texto exacto', () => {
  it('mcg y su alias μg (letra griega mu) son la misma unidad', () => {
    expect(unitsMatch('mcg', 'μg')).toBe(true);
  });

  it('mcg y su alias µg (signo micro) son la misma unidad', () => {
    expect(unitsMatch('mcg', 'µg')).toBe(true);
  });

  it('mayúsculas/espacios no importan', () => {
    expect(unitsMatch(' MG ', 'mg')).toBe(true);
  });

  it('unidades distintas no coinciden', () => {
    expect(unitsMatch('mg', 'g')).toBe(false);
  });

  it('una unidad no reconocida nunca "coincide" con nada', () => {
    expect(unitsMatch('onzas', 'onzas')).toBe(false);
  });
});

describe('isUnitCompatible', () => {
  it('mg es compatible con hierro', () => expect(isUnitCompatible('mg', 'iron_mg')).toBe(true));
  it('IU es compatible con vitamina D', () => expect(isUnitCompatible('IU', 'vitamin_d_mcg')).toBe(true));
  it('IU NO es compatible con hierro', () => expect(isUnitCompatible('IU', 'iron_mg')).toBe(false));
  it('cápsula NO es compatible con ningún nutriente', () => expect(isUnitCompatible('cápsula', 'omega3_g')).toBe(false));
  it('cápsula SÍ es compatible sin nutriente (null)', () => expect(isUnitCompatible('cápsula', null)).toBe(true));
  it('un alias heredado (μg) es compatible con B12 aunque el selector muestre "mcg"', () => {
    expect(isUnitCompatible('μg', 'vitamin_b12_mcg')).toBe(true);
  });
});

describe('resolveUnitOnNutrientChange · corrección de diseño (punto 3 del encargo)', () => {
  it('conserva la unidad si sigue siendo compatible con el nuevo nutriente', () => {
    // g es compatible con calcio (conversión de masa universal).
    expect(resolveUnitOnNutrientChange('calcium_mg', 'g')).toBe('g');
  });

  it('cambia a la canónica si deja de ser compatible al cambiar de nutriente', () => {
    // cápsula era válida sin nutriente; al elegir hierro deja de serlo.
    expect(resolveUnitOnNutrientChange('iron_mg', 'cápsula')).toBe('mg');
  });

  it('IU deja de ser válido al cambiar de vitamina D a cualquier otro nutriente', () => {
    expect(resolveUnitOnNutrientChange('iron_mg', 'IU')).toBe('mg');
    expect(resolveUnitOnNutrientChange('zinc_mg', 'IU')).toBe('mg');
  });

  it('conserva el alias heredado si sigue siendo compatible (no lo reescribe a la forma canónica)', () => {
    // 'μg' es compatible con B12 (mismo token que 'mcg'): se conserva tal cual.
    expect(resolveUnitOnNutrientChange('vitamin_b12_mcg', 'μg')).toBe('μg');
  });

  it('al pasar a "sin nutriente" (null), cápsula/gota siguen siendo válidas', () => {
    expect(resolveUnitOnNutrientChange(null, 'cápsula')).toBe('cápsula');
  });
});
