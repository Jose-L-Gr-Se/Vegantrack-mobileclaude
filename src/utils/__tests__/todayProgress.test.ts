/**
 * Resumen como "día en curso" — derivación pura del estado del día y del
 * único siguiente paso. El estado depende sólo de la fecha local y de si hay
 * registros hoy (nunca de un umbral de "día completo" ni del número de
 * comidas); el texto sólo describe lo registrado frente a los objetivos
 * configurados, sin recomendaciones.
 */
import { deriveDayState, describeNextStep, MEAL_NOUNS, type NextStepInput } from '@/utils/todayProgress';

const TODAY = '2026-09-30';
const YESTERDAY = '2026-09-29';

describe('deriveDayState', () => {
  it('sin registros → empty', () => {
    expect(deriveDayState({ entries: [], today: TODAY, calories: 0, calorieTarget: 2000 })).toBe('empty');
  });

  it('registros + kcal por debajo del objetivo → in_progress', () => {
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 400, calorieTarget: 2000 })).toBe(
      'in_progress'
    );
  });

  it('registros + kcal exactamente en el objetivo → goal_reached', () => {
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 2000, calorieTarget: 2000 })).toBe(
      'goal_reached'
    );
  });

  it('registros + kcal por encima del objetivo → goal_reached', () => {
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 2350, calorieTarget: 2000 })).toBe(
      'goal_reached'
    );
  });

  it('compara con las kcal redondeadas, igual que las "kcal restantes" del hero', () => {
    // 1999.6 se muestra como 2000 → "0 kcal restantes" → objetivo alcanzado.
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 1999.6, calorieTarget: 2000 })).toBe(
      'goal_reached'
    );
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 1999.4, calorieTarget: 2000 })).toBe(
      'in_progress'
    );
  });

  it('registros con 0 kcal (alimento sin dato) siguen siendo un día en curso, no vacío', () => {
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 0, calorieTarget: 2000 })).toBe(
      'in_progress'
    );
  });

  it('sin objetivo de kcal válido nunca hay goal_reached', () => {
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 3000, calorieTarget: 0 })).toBe(
      'in_progress'
    );
  });

  it('el número de comidas no decide nada: 1 o 5 entradas por debajo del objetivo siguen en curso', () => {
    const five = Array.from({ length: 5 }, () => ({ date: TODAY }));
    expect(deriveDayState({ entries: [{ date: TODAY }], today: TODAY, calories: 900, calorieTarget: 2000 })).toBe(
      'in_progress'
    );
    expect(deriveDayState({ entries: five, today: TODAY, calories: 900, calorieTarget: 2000 })).toBe('in_progress');
  });

  it('cambio de fecha: las entradas de ayer no cuentan como registros de hoy', () => {
    const entries = [{ date: YESTERDAY }, { date: YESTERDAY }];
    expect(deriveDayState({ entries, today: YESTERDAY, calories: 1200, calorieTarget: 2000 })).toBe('in_progress');
    expect(deriveDayState({ entries, today: TODAY, calories: 1200, calorieTarget: 2000 })).toBe('empty');
  });
});

describe('describeNextStep', () => {
  const base: NextStepInput = {
    state: 'in_progress',
    isFirstUse: false,
    mealType: 'lunch',
    calories: 620.4,
    calorieTarget: 2000,
    proteinG: 28.2,
    proteinTarget: 110,
    slotHasEntries: false,
  };

  it('empty + primer uso', () => {
    expect(describeNextStep({ ...base, state: 'empty', isFirstUse: true })).toEqual({
      title: 'Tu día empieza aquí',
      context: 'Registra lo primero que comas y verás tu resumen.',
      cta: 'Registrar primera comida',
    });
  });

  it('empty + usuario que vuelve: nombra la franja actual', () => {
    expect(describeNextStep({ ...base, state: 'empty', mealType: 'breakfast' })).toEqual({
      title: 'Hoy aún no hay registros',
      context: 'Añade tu desayuno para empezar el resumen.',
      cta: 'Registrar desayuno',
    });
  });

  it('in_progress con objetivos válidos: kcal y proteína registradas frente al objetivo', () => {
    expect(describeNextStep(base)).toEqual({
      title: 'Siguiente paso',
      context: 'Llevas 620 de 2000 kcal · 28 de 110 g de proteína.',
      cta: 'Registrar comida',
    });
  });

  it('in_progress: franja actual sin entradas → "Registrar {franja}"', () => {
    expect(describeNextStep({ ...base, mealType: 'dinner', slotHasEntries: false }).cta).toBe('Registrar cena');
  });

  it('in_progress: franja actual con entradas → "Añadir a {franja}", con su artículo', () => {
    const cta = (mealType: NextStepInput['mealType']) => describeNextStep({ ...base, mealType, slotHasEntries: true }).cta;
    expect(cta('breakfast')).toBe('Añadir al desayuno');
    expect(cta('lunch')).toBe('Añadir a la comida');
    expect(cta('dinner')).toBe('Añadir a la cena');
    expect(cta('snack')).toBe('Añadir al snack');
  });

  it('goal_reached mantiene "Añadir algo más" tenga o no entradas la franja', () => {
    for (const slotHasEntries of [true, false]) {
      expect(describeNextStep({ ...base, state: 'goal_reached', slotHasEntries }).cta).toBe('Añadir algo más');
    }
  });

  it('in_progress con proteína desconocida (0): no se inventa un "0 de 110 g"', () => {
    const step = describeNextStep({ ...base, proteinG: 0 });
    expect(step.context).toBe('Llevas 620 de 2000 kcal.');
    expect(step.context).not.toContain('proteína');
  });

  it('in_progress con proteína que redondea a 0 tampoco la muestra', () => {
    expect(describeNextStep({ ...base, proteinG: 0.3 }).context).toBe('Llevas 620 de 2000 kcal.');
  });

  it('in_progress sin objetivos configurados: sólo lo registrado, sin "de 0"', () => {
    expect(describeNextStep({ ...base, calorieTarget: 0, proteinTarget: 0 }).context).toBe(
      'Llevas 620 kcal · 28 g de proteína.'
    );
  });

  it('goal_reached: la acción es registrar lo que falte, no comer más', () => {
    const step = describeNextStep({ ...base, state: 'goal_reached', calories: 2100 });
    expect(step).toEqual({
      title: 'Siguiente paso',
      context: 'Ya has alcanzado tu objetivo de calorías de hoy. Si te queda algo por registrar, puedes añadirlo.',
      cta: 'Añadir algo más',
    });
  });

  it('cada franja tiene su nombre en la frase y en el botón', () => {
    for (const [meal, noun] of Object.entries(MEAL_NOUNS)) {
      const step = describeNextStep({ ...base, mealType: meal as NextStepInput['mealType'] });
      expect(step.cta).toBe(`Registrar ${noun}`);
    }
  });

  it('ningún texto usa lenguaje de dieta, culpa o examen', () => {
    const states: NextStepInput[] = [
      { ...base, state: 'empty', isFirstUse: true },
      { ...base, state: 'empty' },
      base,
      { ...base, state: 'goal_reached' },
    ];
    const all = states.map((s) => Object.values(describeNextStep(s)).join(' ')).join(' ').toLowerCase();
    for (const word of ['dieta', 'fallas', 'mal ', 'deberías', 'suspend', 'aprob', 'nota', 'déficit', 'te falta']) {
      expect(all).not.toContain(word);
    }
  });
});
