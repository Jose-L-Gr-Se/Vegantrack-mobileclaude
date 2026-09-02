# Micronutrientes conocidos/desconocidos — modelo, Fase 1 y Fase 2

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

`veganScore.ts` exige, desde la Fase 2 (§5), una confianza mínima para el
crédito completo de un micronutriente parcialmente conocido —salvo que el
objetivo ya se cubra con el suplemento solo—. Esa confianza mínima vive en
una única constante con nombre, `MIN_SCORE_CONFIDENCE = 'medium'`
(`src/utils/nutrition.ts`), comparada con `meetsMinConfidence()`, para que
ningún archivo tenga que repetir su propio número mágico.

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
  `confidence`, `hasEntries` todos por separado. Es la pieza que sustituye a
  las tres copias de `coverage < 0.5 ? value : 0` — conectada en la Fase 2
  (§5).

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

## 4. Qué NO se tocó en la Fase 1 (deliberado)

`DashboardScreen`, `veganScore.ts`, `getMicroTrends`/`MicroTrendsScreen`,
`RecipesScreen`, suplementos, diseño visual, nuevos micronutrientes. Este
alcance quedó cerrado por la Fase 2 (§5) para los tres primeros; el resto
sigue fuera de alcance (§6).

## 5. Fase 2 (implementada): conectar los consumidores

Los tres consumidores llaman ahora a `resolveMicroDisplay` — la única cadena
conceptual es `summarizeEntries() → resolveMicroDisplay() →
Dashboard / VeganScore / Tendencias`. Un test de repositorio
(`src/__tests__/noMicroCoverageGate.test.ts`, mismo patrón que
`noClientEntitlementWrites.test.ts`) escanea el código de producción para
que nadie reintroduzca una copia del gate antiguo.

### DashboardScreen

La tarjeta "Micronutrientes (RDA)" usa `resolveMicroDisplay(agg, fromSupp,
rda)` para cada nutriente. La barra de progreso sigue coloreándose SÓLO por
`pct` (progreso real hacia la RDA: verde ≥90%, ámbar ≥50%, rojo por debajo) —
nunca por la confianza del dato. Antes esto ya "parecía" funcionar así, pero
el `pct` se calculaba sobre un `value` que el gate antiguo podía haber
puesto a 0; con el gate retirado, `pct` refleja el conocido real y deja de
mostrar rojo únicamente por baja cobertura. La confianza se comunica aparte,
en un texto corto junto a la cifra, derivado de `confidence`:

| `confidence` | Texto |
|---|---|
| `none` (día sin registros) | " · sin datos suficientes" (o " · solo suplemento" si hay aporte de suplemento) |
| `low` | " · datos incompletos" |
| `medium` | " · cobertura de datos: N%" |
| `high` | (sin texto adicional) |

### VeganScore

Ver el comentario en `src/utils/veganScore.ts` (regla documentada en el
propio código, CLAUDE.md §8). Resumen:

- **Antes**: `foodVal = coverage >= 0.5 ? value : 0`. Cobertura < 50% → el
  valor conocido se descartaba a 0 pts, aunque `value` fuera real.
- **Ahora**: `ratio = resolveMicroDisplay(...).pct` (nunca se descarta).
  El crédito **completo** (`ratio >= 0.9`) exige además que
  `meetsMinConfidence(confidence, MIN_SCORE_CONFIDENCE)` — salvo que el
  suplemento por sí solo ya cubra la RDA (`fromSupp >= rda`), caso en que la
  cobertura de comida es irrelevante. El medio crédito
  (`0.5 <= ratio < 0.9`) no exige esa confianza — ya era una franja de "en
  progreso", no de certeza.
- Ejemplo comparado: hierro con `value=20mg`, `coverage=0.25` (por
  entradas), `coverageByGrams=0.25` (`confidence='low'`), RDA=8mg (♂).
  Antes: `foodVal=0` → 0 pts. Ahora: `ratio=2.5` (≥0.9), pero `low` no
  alcanza `MIN_SCORE_CONFIDENCE='medium'` → medio crédito, nunca 0 pts.
- Tests: `src/utils/__tests__/veganScore.test.ts`, describe `Fase 2 —
  MIN_SCORE_CONFIDENCE y crédito completo` (5 casos: cobertura baja no da
  crédito completo, cobertura media sí, cobertura alta sí, suplemento cubre
  el objetivo con cobertura de comida baja → crédito completo, día vacío no
  se trata como un cero de comida "conocido").
- Paridad con la PWA: la PWA aplica el mismo gate binario `coverage >= 0.5`
  que aquí se retira (código compartido histórico, no un requisito de
  paridad exacta de fórmula — CLAUDE.md §8 pide documentar la comparación,
  no bloquear la corrección de un bug de datos por paridad). No se ha
  modificado el repo de la PWA en esta sesión.

### Tendencias (`getMicroTrends` / `MicroTrendsScreen`)

`MicroTrendPoint.micros[key]` gana dos campos aditivos —
`hasEntries: boolean` y `confidence: MicroConfidence` — sin tocar el
significado de `value`/`pct` (siguen siendo el conocido total y su % de la
RDA; ya no se calculan con el gate, sino con `resolveMicroDisplay`).

En `MicroTrendsScreen`, la media del periodo (arriba y en "Media por
nutriente") excluye los días sin ningún registro relevante para ese
nutriente (`hasEntries=false` y sin aporte de suplemento): un día así ya no
cuenta como un 0 confirmado en la media, y se muestra "Sin datos" en vez de
"0%". El trazado del gráfico (línea de evolución) sigue dibujando todos los
días tal cual — separar visualmente los huecos de una serie continua exige
un gráfico más complejo, fuera de alcance de esta fase; queda documentado
aquí como limitación conocida, no como un vector nuevo de "0 disfrazado" (la
media, que es el número que más se lee, sí es honesta).

### Qué no cambió en la Fase 2 (deliberado)

- `food_log` no cambia de esquema; no hay cobertura fraccional persistida.
- `supplementStore.ts` no se toca. El aporte de suplemento sigue siendo un
  parámetro aparte (`suppAmount`) que `resolveMicroDisplay` nunca mezcla
  dentro del `MicroAggregate` de comida — verificado con test
  (`microConsumerConsistency.test.ts`).
- `RecipesScreen`, iodo, colina, nuevos micronutrientes, ni ningún
  componente de diseño nuevo.
- No se rediseña visualmente ninguna pantalla: los cambios de UI son sólo
  los necesarios para representar conocido/confianza/incompleto/sin datos.

## 6. Fuera de alcance (pendiente, no iniciado)

- Exponer cobertura de receta en `RecipesScreen` antes de loguearla (no
  exige migración) o abordar la migración de cobertura fraccional
  persistida en `food_log` (si se decide, requiere su propia revisión de
  esquema).
- Iodo, colina y otros micronutrientes nuevos.
