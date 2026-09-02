# Micronutrientes conocidos/desconocidos — modelo y Fase 1

> **Invariante central:** `value` (el aporte de comida conocido de un
> micronutriente) nunca se sustituye por `0` por baja cobertura. La ausencia
> de datos se comunica como una señal de confianza aparte, nunca disfrazada
> de una medición.

---

## 1. El problema

`summarizeEntries()` ya calculaba `value` correctamente (suma exclusiva de
aportes conocidos), pero tres consumidores independientes —`DashboardScreen`,
`veganScore.ts` y `getMicroTrends` (`diaryStore.ts`)— aplicaban, cada uno por
su cuenta, la misma regla:

```ts
const fromFood = coverage >= 0.5 ? value : 0;
```

En cuanto la cobertura del día bajaba del 50%, el valor conocido —ya
calculado, ya honesto— se descartaba por completo. Registrar alimentos de
fuentes sin micronutrientes (frescos BEDCA, foto IA, alimentos propios) podía
hacer que un micronutriente ya registrado pasara a mostrarse como `0,0`.

Diagnóstico completo, ejemplos concretos y comparación de alternativas: ver
la conversación de diseño que precede a este documento. Este fichero cubre
sólo lo que la **Fase 1** deja construido.

## 2. Semántica

- **`known` / `known: boolean`**: sin cambios. Significa "esta fuente afirma
  tener un número fiable para este nutriente en este alimento". No es una
  nota de confianza — es procedencia.
- **`value`**: sin cambios de cálculo. Suma exclusiva de los aportes con
  `known=true`. **Nunca se pone a 0 por baja cobertura** — esa es la regla
  que este trabajo protege con tests.
- **`coverage`** (por número de entradas, existente): describe cuántas de
  las entradas relevantes para un nutriente tienen dato. Sirve para frases
  tipo "3 alimentos sin información suficiente".
- **`coverageByGrams`** (nuevo): `knownGrams / totalGrams`. Más
  representativo de "cuánto de lo que comiste está contabilizado" que un
  recuento ciego de entradas — un alimento grande sin datos pesa más que
  tres guarniciones triviales con datos. Es la base de `confidence`.
- **`hasEntries`** (nuevo): ¿hay algo relevante registrado hoy para este
  nutriente? Distingue **día vacío** (`hasEntries=false`, estado neutro, no
  es una alarma) de **registrado pero sin datos** (`hasEntries=true`,
  `coverage=0`). Estos dos casos comparten `value=0` y no deben tratarse
  igual en ninguna capa de presentación futura.
- **`MicroConfidence`** (`'none' | 'low' | 'medium' | 'high'`): derivada de
  `coverageByGrams` (y de `hasEntries` para `'none'`). No es un dato nuevo
  que se persista — es una función pura del agregado, para no repartir
  umbrales por distintos archivos.

### Por qué cobertura por gramos, y no por calorías o por "relevancia nutricional"

Se evaluaron cuatro formas de calcular cobertura (por entradas, por gramos,
por calorías, ponderada por relevancia nutricional del alimento al
nutriente). La ponderada por relevancia es la más honesta en teoría pero no
es computable sin una taxonomía de alimentos que el proyecto no tiene —
sería circular (para ponderar por el nutriente habría que conocerlo, que es
justo lo que falta). Por calorías añade una unidad menos intuitiva sin
resolver el mismo problema de raíz. Por gramos es simple, determinista, y el
dato (`serving_size_g`) ya existe en cada `FoodLogEntry` sin heurísticas
nuevas — se mantiene además la cobertura por entradas, para los textos que
son inherentemente un recuento de alimentos.

### La regla `MIN_SCORE_CONFIDENCE`

`veganScore.ts` no se toca en esta fase, pero cuando se conecte (Fase 2), el
crédito completo de un micronutriente parcialmente conocido deberá exigir
una confianza mínima —salvo que el objetivo ya se cubra con el suplemento
solo—. Esa confianza mínima vive en una única constante con nombre,
`MIN_SCORE_CONFIDENCE = 'medium'` (`src/utils/nutrition.ts`), comparada con
`meetsMinConfidence()`, para que ningún archivo tenga que repetir su propio
número mágico.

## 3. Lo que se ha construido en la Fase 1

**`src/types/index.ts`** — `MicroAggregate` ampliado de forma aditiva:
`knownGrams`, `totalGrams`, `coverageByGrams`, `hasEntries`. `value`,
`knownEntries`, `totalEntries`, `coverage` sin cambios de significado.

**`src/utils/nutrition.ts`**:
- `summarizeEntries()` — añade el tracking de gramos con la misma regla de
  relevancia que ya usaba el recuento de entradas (una entrada `manual` sin
  dato no cuenta contra la cobertura; el resto de fuentes sí). No cambia
  ningún valor que ya calculaba correctamente.
- `MicroConfidence`, `microConfidence()` — deriva la confianza de un
  agregado.
- `MIN_SCORE_CONFIDENCE`, `meetsMinConfidence()` — la constante única, lista
  para que la use la Fase 2.
- `MicroDisplay`, `resolveMicroDisplay()` — función pura, sin React, que
  junta comida conocida + suplemento + RDA en una representación de
  presentación con `known`, `pct`, `coverage`, `coverageByGrams`,
  `confidence`, `hasEntries` todos por separado. Es la pieza que sustituirá
  a las tres copias de `coverage < 0.5 ? value : 0` cuando se conecten los
  consumidores.

**Recetas — `computeRecipeNutrients()` (sin cambios de código, sólo tests
que documentan su comportamiento real)**: hallazgo confirmado por tests —
la función **ya** conserva la suma parcial de los ingredientes conocidos en
`acc[key]` aunque otro ingrediente falle y `acc[knownKey]` acabe en `false`.
El helper interno `micro()` sólo hace un `return` anticipado para el
ingrediente sin dato; nunca reinicia lo ya acumulado. Lo que descarta esa
suma parcial es un paso **distinto y posterior**, `logRecipe()` (fuera de
`computeRecipeNutrients`, no tocado en esta fase), que sólo usa el total
cuando el flag booleano es `true`.

Esto importa para la Fase 2: la limitación real no está en el cálculo, está
en que **`food_log` persiste `known` como booleano**, no como una fracción —
una entrada persistida sólo puede decir "lo sé" o "no lo sé", nunca "lo sé al
75%". Ampliar eso exige una migración de esquema (nuevas columnas o un campo
fraccional), fuera del alcance de este P0. La Fase 2 puede, sin tocar el
esquema, exponer la cobertura de una receta en su propia pantalla (antes de
loguearla) usando lo que `computeRecipeNutrients` ya calcula hoy.

## 4. Qué NO se ha tocado en esta fase (deliberado)

`DashboardScreen`, `veganScore.ts`, `getMicroTrends`/`MicroTrendsScreen`,
`RecipesScreen`, suplementos, diseño visual, nuevos micronutrientes. Ninguno
de estos consumidores usa todavía `resolveMicroDisplay` ni
`MIN_SCORE_CONFIDENCE`. El test de `veganScore.ts` que documenta el bug
conocido (`"cobertura < 50% ignora el valor de comida"`) sigue en verde
porque describe el comportamiento **actual, sin cambios** de ese archivo —
se actualizará cuando se conecte en la Fase 2.

## 5. Fase 2 (pendiente, no iniciada)

- Conectar `DashboardScreen`, `veganScore.ts` y `getMicroTrends` a
  `resolveMicroDisplay`, retirando las tres copias del gate antiguo.
- Aplicar `MIN_SCORE_CONFIDENCE` en `veganScore.ts` para el crédito completo
  de un micronutriente parcialmente conocido.
- Nuevos textos de UI en `DashboardScreen` basados en `confidence`, sin
  alarmismo.
- Decidir si merece la pena exponer cobertura de receta en `RecipesScreen`
  (no exige migración) o abordar la migración de cobertura fraccional
  persistida (si se decide, requiere su propia revisión de esquema).
