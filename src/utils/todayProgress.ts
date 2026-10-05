/**
 * Resumen de hoy como "día en curso" con un único siguiente paso.
 *
 * El estado del día depende sólo de la FECHA local (`todayISO()`) y de si hay
 * registros hoy — nunca de un umbral de "día completo" ni del número de
 * comidas: con los datos que existen (≥1 fila en `food_log`) no hay forma
 * honesta de saber si un día está "terminado". Hoy siempre está en curso.
 *
 * Todo es puro y determinista: ni red, ni reloj, ni stores — quien llama
 * pasa `today`, la franja de comida (`mealTypeForHour`) y los totales ya
 * calculados por `getDaySummary()`. Así el mismo cálculo sirve para pintar
 * la tarjeta y para el evento `dashboard_viewed`, y funciona sin conexión.
 *
 * Los textos sólo describen lo registrado frente a los objetivos que el
 * usuario configuró (aritmética, no recomendación): ninguna sugerencia de
 * alimentos, ningún umbral nutricional nuevo, ningún juicio sobre el día.
 */
import type { MealType } from '@/types';

export type DayState = 'empty' | 'in_progress' | 'goal_reached';

export interface DayStateInput {
  /** Entradas cargadas en el diario; sólo cuentan las de `today`. */
  entries: readonly { date: string }[];
  /** Fecha local de hoy (`todayISO()`). */
  today: string;
  /** Kcal registradas hoy (`getDaySummary().calories`). */
  calories: number;
  /** Objetivo de kcal del perfil; ≤ 0 = sin objetivo configurado. */
  calorieTarget: number;
}

/**
 * - Sin registros con fecha `today` → `empty`.
 * - Con registros y un objetivo de kcal configurado que ya se ha alcanzado o
 *   superado → `goal_reached`. Se compara con las kcal REDONDEADAS, igual que
 *   las "kcal restantes" del hero, para que la tarjeta nunca contradiga lo
 *   que se ve justo encima ("0 kcal restantes" ⇔ objetivo alcanzado).
 * - Cualquier otro caso con registros (incluido sin objetivo) → `in_progress`.
 */
export function deriveDayState({ entries, today, calories, calorieTarget }: DayStateInput): DayState {
  const hasEntriesToday = entries.some((e) => e.date === today);
  if (!hasEntriesToday) return 'empty';
  if (calorieTarget > 0 && Math.round(calories) >= calorieTarget) return 'goal_reached';
  return 'in_progress';
}

/**
 * Nombre de cada franja dentro de una frase ("Añade tu desayuno…",
 * "Registrar cena"). No reutiliza `MEAL_LABELS` tal cual porque allí la
 * merienda es "Snacks" (plural, título de sección del Diario), que no
 * concuerda con "tu …" ni con un único registro.
 */
export const MEAL_NOUNS: Record<MealType, string> = {
  breakfast: 'desayuno',
  lunch: 'comida',
  dinner: 'cena',
  snack: 'snack',
};

/** "Añadir a {franja}" con su artículo: "al desayuno", "a la comida"… */
const ADD_TO_MEAL: Record<MealType, string> = {
  breakfast: 'Añadir al desayuno',
  lunch: 'Añadir a la comida',
  dinner: 'Añadir a la cena',
  snack: 'Añadir al snack',
};

export interface NextStepInput {
  state: DayState;
  /** Nunca ha registrado nada (`profile.last_log_date` nulo con perfil cargado). */
  isFirstUse: boolean;
  /** Franja actual según `mealTypeForHour`. */
  mealType: MealType;
  /** ¿Ya hay entradas de hoy en esa franja? Decide "Añadir a…" vs "Registrar…". */
  slotHasEntries: boolean;
  calories: number;
  calorieTarget: number;
  proteinG: number;
  proteinTarget: number;
}

export interface NextStep {
  title: string;
  context: string;
  cta: string;
}

function progressLine({ calories, calorieTarget, proteinG, proteinTarget }: NextStepInput): string {
  const kcal = Math.round(calories);
  let line = calorieTarget > 0 ? `Llevas ${kcal} de ${Math.round(calorieTarget)} kcal` : `Llevas ${kcal} kcal`;
  // La proteína sólo aparece cuando hay un valor registrado real: los
  // alimentos sin dato de macros cuentan como 0 en `summarizeEntries`, así
  // que un 0 aquí puede significar "desconocido", no "nada" — nunca se
  // muestra "0 de 110 g" como si fuera un dato.
  const protein = Math.round(proteinG);
  if (protein > 0) {
    line +=
      proteinTarget > 0
        ? ` · ${protein} de ${Math.round(proteinTarget)} g de proteína`
        : ` · ${protein} g de proteína`;
  }
  return `${line}.`;
}

export function describeNextStep(input: NextStepInput): NextStep {
  const noun = MEAL_NOUNS[input.mealType];
  switch (input.state) {
    case 'empty':
      return input.isFirstUse
        ? {
            title: 'Tu día empieza aquí',
            context: 'Registra lo primero que comas y verás tu resumen.',
            cta: 'Registrar primera comida',
          }
        : {
            title: 'Hoy aún no hay registros',
            context: `Añade tu ${noun} para empezar el resumen.`,
            cta: `Registrar ${noun}`,
          };
    case 'in_progress':
      return {
        title: 'Siguiente paso',
        context: progressLine(input),
        // Franja ya empezada → se añade a ella; franja vacía → se registra.
        cta: input.slotHasEntries ? ADD_TO_MEAL[input.mealType] : `Registrar ${noun}`,
      };
    case 'goal_reached':
      // La acción es registrar lo que falte, nunca una invitación a comer más.
      return {
        title: 'Siguiente paso',
        context: 'Ya has alcanzado tu objetivo de calorías de hoy. Si te queda algo por registrar, puedes añadirlo.',
        cta: 'Añadir algo más',
      };
  }
}
