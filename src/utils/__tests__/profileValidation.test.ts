/**
 * Validación de plausibilidad de altura/peso/fecha de nacimiento — cierre
 * del Bug B1 de la auditoría de onboarding. Funciones puras, sin React ni
 * Supabase.
 */
import {
  AGE_YEARS_RANGE,
  birthDateMessage,
  getAge,
  HEIGHT_CM_RANGE,
  isPlausibleAnthropometrics,
  numericFieldMessage,
  validateBirthDate,
  validateHeightCm,
  validateWeightKg,
  WEIGHT_KG_RANGE,
} from '@/utils/profileValidation';

/**
 * Fecha de nacimiento `years` años antes de `ref`, retrocediendo además
 * `extraDaysBeforeRef` días para que el cumpleaños de ese año ya haya
 * pasado respecto a `ref` (mismo truco que usa nutrition.test.ts) — así
 * `getAge(resultado, ref)` da exactamente `years`, sin depender de la
 * fecha real del sistema en el que corran los tests.
 */
function isoYearsBeforeRef(ref: Date, years: number, extraDaysBeforeRef = 1): string {
  const d = new Date(ref);
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - extraDaysBeforeRef);
  return d.toISOString().split('T')[0];
}

describe('validateHeightCm', () => {
  it('vacío', () => {
    expect(validateHeightCm('')).toEqual({ status: 'empty', value: null });
    expect(validateHeightCm('   ')).toEqual({ status: 'empty', value: null });
  });

  it('no numérico', () => {
    expect(validateHeightCm('abc').status).toBe('not_numeric');
    // Number() no hace parseo parcial: a diferencia de parseFloat, "5cm" no es 5.
    expect(validateHeightCm('5cm').status).toBe('not_numeric');
    expect(validateHeightCm('1.2.3').status).toBe('not_numeric');
  });

  it('NaN/Infinity', () => {
    expect(validateHeightCm('NaN').status).toBe('not_numeric');
    expect(validateHeightCm('Infinity').status).toBe('invalid_number');
    expect(validateHeightCm('-Infinity').status).toBe('invalid_number');
  });

  it('no positivo', () => {
    expect(validateHeightCm('0').status).toBe('non_positive');
    expect(validateHeightCm('-10').status).toBe('non_positive');
  });

  it('fuera de rango plausible', () => {
    expect(validateHeightCm('1').status).toBe('out_of_range');
    expect(validateHeightCm('89').status).toBe('out_of_range');
    expect(validateHeightCm('251').status).toBe('out_of_range');
    expect(validateHeightCm('400').status).toBe('out_of_range');
  });

  it('válido, incluyendo valores frontera', () => {
    expect(validateHeightCm('170')).toEqual({ status: 'valid', value: 170 });
    expect(validateHeightCm(String(HEIGHT_CM_RANGE.min))).toEqual({
      status: 'valid',
      value: HEIGHT_CM_RANGE.min,
    });
    expect(validateHeightCm(String(HEIGHT_CM_RANGE.max))).toEqual({
      status: 'valid',
      value: HEIGHT_CM_RANGE.max,
    });
  });

  it('coma y punto decimal producen el mismo resultado', () => {
    expect(validateHeightCm('175,5')).toEqual({ status: 'valid', value: 175.5 });
    expect(validateHeightCm('175.5')).toEqual({ status: 'valid', value: 175.5 });
  });
});

describe('validateWeightKg', () => {
  it('válido, fuera de rango y no positivo', () => {
    expect(validateWeightKg('65')).toEqual({ status: 'valid', value: 65 });
    expect(validateWeightKg('29').status).toBe('out_of_range');
    expect(validateWeightKg('301').status).toBe('out_of_range');
    expect(validateWeightKg(String(WEIGHT_KG_RANGE.min))).toEqual({
      status: 'valid',
      value: WEIGHT_KG_RANGE.min,
    });
    expect(validateWeightKg(String(WEIGHT_KG_RANGE.max))).toEqual({
      status: 'valid',
      value: WEIGHT_KG_RANGE.max,
    });
    expect(validateWeightKg('0').status).toBe('non_positive');
  });

  it('coma y punto decimal producen el mismo resultado', () => {
    expect(validateWeightKg('72,5')).toEqual(validateWeightKg('72.5'));
  });
});

describe('numericFieldMessage', () => {
  it('devuelve un texto no técnico para cada estado', () => {
    expect(numericFieldMessage('not_numeric', 'Altura', HEIGHT_CM_RANGE)).toMatch(/número/i);
    expect(numericFieldMessage('non_positive', 'Peso', WEIGHT_KG_RANGE)).toMatch(/mayor que cero/i);
    expect(numericFieldMessage('out_of_range', 'Altura', HEIGHT_CM_RANGE)).toContain(
      `${HEIGHT_CM_RANGE.min}`
    );
  });
});

describe('validateBirthDate', () => {
  const ref = new Date('2026-06-11');

  it('vacío', () => {
    expect(validateBirthDate('', ref)).toEqual({ status: 'empty', age: null });
  });

  it('formato inválido: no ISO o fecha de calendario inexistente', () => {
    expect(validateBirthDate('11/06/2000', ref).status).toBe('invalid_format');
    expect(validateBirthDate('2000-13-01', ref).status).toBe('invalid_format'); // mes 13
    expect(validateBirthDate('2000-02-30', ref).status).toBe('invalid_format'); // 30 de feb
  });

  it('fecha futura', () => {
    const future = isoYearsBeforeRef(ref, -1, 0); // un año después de ref
    const r = validateBirthDate(future, ref);
    expect(r.status).toBe('future_date');
    expect(r.age).toBeLessThan(0);
  });

  it('demasiado antigua (edad por encima del rango)', () => {
    const tooOld = isoYearsBeforeRef(ref, AGE_YEARS_RANGE.max + 5);
    const r = validateBirthDate(tooOld, ref);
    expect(r.status).toBe('out_of_range');
  });

  it('demasiado joven (edad por debajo del rango)', () => {
    const tooYoung = isoYearsBeforeRef(ref, AGE_YEARS_RANGE.min - 1);
    const r = validateBirthDate(tooYoung, ref);
    expect(r.status).toBe('out_of_range');
  });

  it('valores frontera de edad son válidos', () => {
    const exactlyMin = isoYearsBeforeRef(ref, AGE_YEARS_RANGE.min);
    expect(validateBirthDate(exactlyMin, ref)).toEqual({ status: 'valid', age: AGE_YEARS_RANGE.min });

    const exactlyMax = isoYearsBeforeRef(ref, AGE_YEARS_RANGE.max);
    expect(validateBirthDate(exactlyMax, ref)).toEqual({ status: 'valid', age: AGE_YEARS_RANGE.max });
  });

  it('válida dentro de rango', () => {
    const r = validateBirthDate(isoYearsBeforeRef(ref, 30), ref);
    expect(r.status).toBe('valid');
    expect(r.age).toBe(30);
  });
});

describe('birthDateMessage', () => {
  it('devuelve un texto no técnico para cada estado', () => {
    expect(birthDateMessage('future_date')).toMatch(/futura/i);
    expect(birthDateMessage('invalid_format')).toMatch(/fecha/i);
    expect(birthDateMessage('out_of_range')).toContain(`${AGE_YEARS_RANGE.min}`);
  });
});

describe('isPlausibleAnthropometrics — defensa adicional de calculateTDEE', () => {
  it('acepta un perfil plausible', () => {
    expect(isPlausibleAnthropometrics({ height_cm: 180, weight_kg: 80, ageYears: 30 })).toBe(true);
  });

  it('rechaza altura, peso o edad fuera de rango, aunque sean números "normales"', () => {
    expect(isPlausibleAnthropometrics({ height_cm: 1, weight_kg: 80, ageYears: 30 })).toBe(false);
    expect(isPlausibleAnthropometrics({ height_cm: 180, weight_kg: 999999, ageYears: 30 })).toBe(false);
    expect(isPlausibleAnthropometrics({ height_cm: 180, weight_kg: 80, ageYears: -5 })).toBe(false);
    expect(isPlausibleAnthropometrics({ height_cm: 180, weight_kg: 80, ageYears: 200 })).toBe(false);
  });

  it('rechaza NaN/Infinity aunque un llamador se salte la validación de texto', () => {
    expect(isPlausibleAnthropometrics({ height_cm: NaN, weight_kg: 80, ageYears: 30 })).toBe(false);
    expect(isPlausibleAnthropometrics({ height_cm: Infinity, weight_kg: 80, ageYears: 30 })).toBe(false);
  });
});

describe('getAge (re-exportada sin cambios desde nutrition.ts)', () => {
  it('coincide con el comportamiento histórico', () => {
    expect(getAge('2000-12-31', new Date('2026-06-11'))).toBe(25);
    expect(getAge('2000-01-01', new Date('2026-06-11'))).toBe(26);
  });
});
