# Unidades de suplementos — Fases 1 a 6

> **Invariante central:** ninguna dosis se convierte "a ojo". Toda
> combinación de cantidad/unidad/nutriente tiene una salida definida —
> éxito, necesita revisión, o rechazo explícito con motivo — nunca un número
> silenciosamente incorrecto.

## El problema

`supplementStore.getTodayContributions()` suma `dose_amount` sin mirar
`dose_unit`. Un suplemento real y activo en producción tiene `dose_amount:
150`, `dose_unit: 'g'` para calcio — interpretado como gramos, 150 g de
calcio elemental no es plausible; casi con toda seguridad debía ser 150 mg.
Diagnóstico completo, inventario de las 34 filas reales de producción y las
alternativas descartadas: auditoría de diseño que precede a este commit.

## Qué se ha construido en la Fase 1

`src/utils/supplementUnits.ts` — función pura `normalizeSupplementDose()`,
sin React, sin stores, sin Supabase. Tres resultados posibles:

- **`success`** — conversión calculada y dentro de un rango plausible.
  `canonicalUnit` es `null` cuando `nutrientKey` es `null` (no hay nutriente
  al que aportar, así que no hay canónica que calcular — el valor se
  devuelve tal cual).
- **`needs_review`** — la conversión SÍ se pudo calcular, pero supera el
  techo de `SUPPLEMENT_PLAUSIBILITY_CEILING` para ese nutriente.
  `canonicalAmount`/`canonicalUnit` se conservan siempre — nunca se
  descartan ni se sustituyen por 0 — junto con `reviewReason`, una nota
  calmada ("comprueba la unidad"), nunca una advertencia médica.
- **`unsupported`** — no hay conversión posible: unidad desconocida,
  nutriente desconocido, IU sin factor verificado para ese nutriente, o
  cápsula/gota con un nutriente asociado (`requires_amount_per_unit` — el
  modelo actual no sabe cuánto nutriente contiene una unidad de
  administración, y esta función nunca asume que 1 cápsula = 1 unidad del
  nutriente).

Conversiones de masa (mcg↔mg↔g) son universales para cualquier nutriente
soportado. La única conversión IU implementada es vitamina D (NIH Office of
Dietary Supplements, fact sheet para profesionales de salud, verificado para
esta auditoría: **1 mcg = 40 IU**, válido para D2 y D3 por igual). Vitamina E
y vitamina A tienen factores IU dependientes de la forma química/fuente — no
se implementan, y tampoco se rastrean hoy en VeganTrack.

Alias de microgramo aceptados: `mcg`, y los dos caracteres Unicode "micro"
que aparecen en datos reales (`μ` U+03BC, letra griega mu — usado por los
presets de la PWA — y `µ` U+00B5, signo micro), normalizados con `\u`
explícito para no depender de cómo se vea el carácter en un editor.

Los techos de plausibilidad viven en un único mapa con nombre,
`SUPPLEMENT_PLAUSIBILITY_CEILING` — heurísticos, no clínicos, elegidos con
margen amplio sobre cualquier producto comercial conocido y verificados
contra las 34 filas reales de producción para no generar falsos positivos.

## Qué se ha conectado en la Fase 2

`supplementStore.getTodayContributions()` y `diaryStore.getMicroTrends()`
—los dos únicos sitios de producción que sumaban `dose_amount` directamente—
pasan ahora por `normalizeSupplementDose()`. Ninguno de los dos cambia su
forma de salida (`Partial<Record<string, number>>` y `MicroTrendPoint`
respectivamente): Dashboard, VeganScore y `MicroTrendsScreen` siguen
consumiéndolos exactamente igual, sin saber que por debajo hay una
conversión de unidades — cero cambios en esos tres ficheros.

Regla aplicada en ambos sitios: sólo una dosis con `status: 'success'` entra
en el total. `needs_review` y `unsupported` quedan excluidas de la
contribución nutricional — nunca se convierten en un 0 silencioso ni se
suman con la unidad equivocada. El detalle completo (incluidas las
excluidas y por qué) no se pierde: `supplementStore.ts` lo expone en un
getter nuevo, `getTodayContributionDetails()`, del que
`getTodayContributions()` es una proyección filtrada — así una capa futura
(Fase 3, UI) puede mostrar "esta dosis necesita revisión" sin tener que
recalcular nada.

No se ha añadido ninguna persistencia nueva (`canonicalAmount` sigue sin
guardarse), ni se ha tocado `dose_amount`/`dose_unit` almacenados, ni el
esquema de Supabase, ni `SupplementEditor.tsx`, ni la PWA.

## Qué se ha construido en la Fase 3

`SupplementEditor.tsx` ya no ofrece las seis unidades sin criterio: el
selector, la unidad por defecto y la validación al guardar usan la misma
fuente de verdad añadida a `supplementUnits.ts` — `compatibleUnitsFor()`,
`defaultUnitFor()`, `isUnitCompatible()`, `unitsMatch()` y
`resolveUnitOnNutrientChange()`. Todas son funciones nuevas, puramente
derivadas de `SUPPLEMENT_CANONICAL_UNIT`/`NUTRIENTS_WITH_IU_SUPPORT` —
`normalizeSupplementDose()` no se ha tocado ni una línea.

- El selector sólo muestra las unidades compatibles con el nutriente
  elegido, con la canónica primero. Cápsula/gota desaparecen en cuanto hay
  un nutriente asociado.
- Al cambiar de nutriente, la unidad se conserva si sigue siendo compatible
  y sólo cae a la canónica si deja de serlo — nunca al abrir el editor
  sobre un dato ya guardado, sólo al cambiar el nutriente a mano.
- Debajo del campo se muestra en vivo, formateado con separador de miles,
  la equivalencia calculada por `normalizeSupplementDose()` ("Equivale a
  1.000 mcg de Vitamina B12") — nunca una fórmula reimplementada en el
  componente.
- `needs_review` muestra un aviso calmado ("Esta cantidad parece alta para
  esta unidad...") y **deja guardar**: `dose_amount`/`dose_unit` se
  guardan exactamente como los escribió el usuario, nunca se sustituyen
  por `canonicalAmount`/`canonicalUnit`. Así se evita el caso "calcio
  150 g" sin reescribir el dato: la app avisa, pero no decide por el
  usuario ni inventa qué quiso decir.
- `unsupported` bloquea el guardado con un mensaje comprensible por motivo
  (nunca el nombre interno del `reason`) — incluido un nutriente
  desconocido heredado de datos sin `CHECK constraint`, que no rompe el
  editor: cae a mostrar sólo unidades de masa, nunca inventa cápsula/gota
  ni IU para él.

## Qué NO se ha tocado (deliberado)

Dashboard/VeganScore/`MicroTrendsScreen` (sin rediseño — sólo reciben datos
ya correctos), Supabase, el esquema de `public.supplements`, la
representación almacenada (`dose_amount`/`dose_unit`, sin nuevas columnas),
`supplementStore.ts`, `diaryStore.ts` y la PWA.

## Tests

`src/utils/__tests__/supplementUnits.test.ts` — conversiones exactas,
alias, rechazos (IU incompatible, cápsula/gota con nutriente, unidad y
nutriente desconocidos, cantidad inválida), semántica de plausibilidad
(`needs_review` distinto de `unsupported`, conserva la conversión), y
fixtures basados directamente en las 34 filas reales de producción —
incluida la fila de calcio (150 g → `needs_review` a 150 000 mg, nunca un
cálculo normal).

`src/stores/__tests__/supplementStore.test.ts` (Fase 2) — los mismos casos
pero a través de `getTodayContributions()`/`getTodayContributionDetails()`:
confirma que sólo `success` entra en el total, que `needs_review` conserva
`canonicalAmount`/`canonicalUnit`/`reviewReason`, y que un mismo día puede
tener las tres puertas a la vez sin que se mezclen.

`src/stores/__tests__/diaryStore.getMicroTrends.test.ts` (ampliado en la
Fase 2) — confirma que la serie histórica de tendencias también pasa por
`normalizeSupplementDose()`: una dosis en mg se convierte antes de sumarse,
y una dosis `needs_review`/`unsupported` no aparece en la tendencia.

`src/utils/__tests__/supplementUnits.compat.test.ts` (Fase 3) — unidad por
defecto por nutriente, qué unidades ofrece `compatibleUnitsFor()` para cada
uno (IU sólo en vitamina D, cápsula/gota nunca con nutriente), y
`resolveUnitOnNutrientChange()` conservando o reajustando la unidad al
cambiar de nutriente.

`src/components/__tests__/SupplementEditor.dosePresentation.test.ts` (Fase
3) — `formatDosePreview()` y `unsupportedMessageFor()`, las dos funciones
puras que el editor exporta para no atar la presentación al árbol de React
(`@testing-library/react-native`/`renderHook` no son fiables en este
entorno — mismo precedente que `proEntitlement.ts`).

## Fase 5 — hacer visible `needs_review` fuera del editor

Antes de esta fase, un suplemento `needs_review` desaparecía en silencio:
`getTodayContributions()` y `getMicroTrends()` (Fase 2) ya lo excluían
correctamente del cálculo, pero nada en la app le decía al usuario que
existía una dosis pendiente de revisar salvo que abriera ese suplemento
concreto a editar.

**Qué significa `needs_review`:** la dosis SÍ se pudo convertir a la unidad
canónica del nutriente, pero el resultado supera el techo de plausibilidad
de `SUPPLEMENT_PLAUSIBILITY_CEILING` — probablemente una unidad
equivocada (el caso central: calcio `150 g`, que se interpretaría como
150 000 mg). No es un error de guardado ni una unidad incompatible
(`unsupported`, fuera de esta fase): es una cifra calculable pero
sospechosa.

**Dónde se muestra:**
- **Diario y Perfil** (listado de suplementos): un icono discreto
  (`alert-circle-outline`, `semantic.warning`) junto a la dosis de cada
  suplemento **configurado** — tomado hoy o no. `supplementsNeedingReview()`
  evalúa todos los suplementos con `nutrient_key`, no sólo los de hoy: es
  una propiedad de cómo está configurado el suplemento, no de un evento de
  toma. Tocar el icono (o la fila, en Perfil) abre el editor existente de
  ese suplemento — ninguna pantalla nueva.
- **Dashboard**: una única tarjeta agregada, sólo si hay ≥1 suplemento
  `needs_review` **tomado hoy** (`getTodayContributionDetails()` filtrado a
  `needs_review`) — nunca un aviso por micronutriente, nunca en VeganScore,
  nunca en Tendencias. Tocable: con un único suplemento abre directamente su
  editor; con varios, abre la pantalla de gestión de suplementos existente
  (Perfil).

**No modifica los datos originales:** `dose_amount`/`dose_unit` siguen
siendo la única fuente de verdad, sin persistir ningún flag de "needs
review" ni "visto" — el estado se deriva en cada lectura llamando a
`normalizeSupplementDose()`/`supplementsNeedingReview()`, exactamente como
en las fases anteriores. Nada nuevo en Supabase.

**Se excluye del cálculo hasta corregirse:** sigue sin contar en
`getTodayContributions()`/`getMicroTrends()` (comportamiento de la Fase 2,
sin cambios). Corregir la unidad en el editor y guardar es lo único que lo
reincorpora — no hay manera de "confirmarlo tal cual" sin cambiar la unidad
o la cantidad, limitación conocida y documentada, no resuelta aquí.

**`unsupported` queda fuera de esta fase:** no se activa ningún aviso nuevo
para suplementos `unsupported` (unidad desconocida, incompatible, o
cápsula/gota con nutriente) en Diario, Perfil o Dashboard — sólo el editor
los bloquea, como ya hacía desde la Fase 3. El código está escrito
dirigido por `dose.status`, no por heurísticas propias, para que una fase
futura pueda añadir su propio tratamiento sin rediseñar nada.

**Copy único:** `src/utils/supplementDoseCopy.ts` — `NEEDS_REVIEW_WARNING_TEXT`
(editor), `NEEDS_REVIEW_ACCESSIBILITY_LABEL` (icono de listado) y
`describeNeedsReviewBanner()` (tarjeta de Dashboard). Ningún componente
reescribe estos textos a mano — verificado por un test estático
(`noDuplicateSupplementCopy.test.ts`, mismo patrón que
`noMicroCoverageGate.test.ts`).

**Navegación:** un único añadido, mínimo y aditivo — `MainTabParamList.Profile`
gana `{ openSupplementId?, openSupplements? }` (mismo patrón que ya usaba
`Search`), consumido una vez por `ProfileScreen` y limpiado con
`setParams()`. Ninguna pantalla ni ruta nueva.

**Tests:** `supplementUnits.needsReview.test.ts` (`supplementsNeedingReview()`),
`supplementDoseCopy.test.ts` (`describeNeedsReviewBanner()` y las
constantes), ampliación de `supplementStore.test.ts` (el banner de
Dashboard sólo cuenta lo tomado hoy) y `noDuplicateSupplementCopy.test.ts`
(guardia estática). La interacción de navegación (tocar el icono/tarjeta y
llegar al editor correcto) no tiene test automatizado — mismo límite de
entorno que en fases anteriores (`@testing-library/react-native`/`renderHook`
no fiables aquí) — queda como validación manual.

## Fase 6 — `unsupported` heredado

Auditoría de solo lectura previa a esta fase (34 filas reales de
`public.supplements`, sin tocar nada): 30 `success`, 3 `needs_review`, 1
`unsupported` — el único `unsupported` activo y tomado es "Vitamina B12 · 25
cápsula · `nutrient_key = vitamin_b12_mcg`", creado antes de que la Fase 3
bloqueara esa combinación desde el editor. Esa fila seguía desapareciendo en
silencio: Fase 2 ya la excluye del cálculo, pero hasta esta fase no había
ninguna señal de por qué.

**`normalizeSupplementDose()` sin tocar** (confirmado en el diff: el único
hunk en `supplementUnits.ts` está muy por debajo de su definición). Sin
cambios en Supabase, esquema, `dose_amount`/`dose_unit` almacenados,
`supplementStore.ts`, `diaryStore.ts`, `SupplementEditor.tsx`, VeganScore ni
MicroTrends.

### Cómo se distingue `needs_review` de `unsupported`

Son estados con forma distinta desde la Fase 1
(`SupplementDoseNeedsReview` vs. `SupplementDoseUnsupported`) y ahora
también con tratamiento visual distinto en cada superficie:

| | `needs_review` | `unsupported` |
|---|---|---|
| Significado | Convertible, pero implausible | No convertible en absoluto |
| ¿Se puede guardar desde el editor? | Sí (aviso, no bloqueo) | No (bloquea) |
| ¿Entra en el cálculo? | No (desde la Fase 2) | No (desde la Fase 2) |
| Icono en listados | `alert-circle-outline` (mismo glifo) | `alert-circle-outline` (mismo glifo) |
| Etiqueta accesible | "Necesita revisión: esta cantidad parece alta..." | Mensaje específico del `reason` (p. ej. "...falta indicar cuánto nutriente contiene cada cápsula.") |
| Banner de Dashboard | "...revisa su/sus unidad(es)" | "...revisa su/sus dosis" |
| Ambos el mismo día | — | Un único banner combinado: "...revísalo(s)", sin mezclar motivos por nutriente |

El icono es deliberadamente el mismo glifo en ambos casos (mismo lenguaje
visual que la Fase 5) — lo que distingue a un lector de pantalla, y lo que
distingue el banner de Dashboard, es el TEXTO, no la forma del icono.

### Qué ocurre específicamente con "B12 · 25 cápsula"

- **Diario y Perfil**: la fila muestra el icono de atención (estuviera
  tomada hoy o no — `supplementsNeedingAttention()` evalúa la configuración,
  no el evento de toma). Tocarlo abre el `SupplementEditor` existente sobre
  ese suplemento.
- **El editor** (sin cambios en esta fase): al abrirse, ya calculaba en vivo
  `normalizeSupplementDose()` desde la Fase 3 — para este registro heredado
  ya mostraba, y sigue mostrando, "Para registrar cápsulas o gotas con este
  nutriente necesitas indicar cuánto nutriente contiene cada una..." y
  bloqueaba el guardado si no se corrige. No hace falta ningún cambio para
  que esto funcione con datos heredados: ya funcionaba así.
- **Dashboard**: el día que se marca como tomada, cuenta en el banner
  agregado ("...revisa su dosis", o el mensaje combinado si coincide con un
  `needs_review` el mismo día). Los días que no se toma, no aparece en
  Dashboard (mismo criterio que siempre: el banner es sólo "hoy").
- **En ningún momento se inventa `amount_per_unit`** ni se persiste nada
  nuevo: la fila sigue exactamente igual en Supabase.

### Copy (Fase 6)

Añadido a `src/utils/supplementDoseCopy.ts` — nunca al editor, que mantiene
su propio `UNSUPPORTED_MESSAGES` (Fase 3) para el momento distinto de "por
qué no puedo guardar esto ahora":

- `unsupportedAttentionMessage(dose)` — mensaje por `reason`, con el texto
  genérico ("...no podemos interpretar su dosis.") como resultado por
  defecto y textos diferenciados para `requires_amount_per_unit`,
  `unit_incompatible_with_nutrient`, `unknown_unit` y `unknown_nutrient`.
- `attentionAccessibilityLabel(dose)` — despacha a `needs_review` o
  `unsupported` según corresponda; usado por los listados.
- `attentionLabelsBySupplementId(supplements)` — mapa id→etiqueta, para que
  Diario y Perfil hagan una única llamada y luego `.get(s.id)` por fila.
- `describeUnsupportedBanner(count)` / `describeAttentionBanner(needsReviewCount, unsupportedCount)`
  — el banner de Dashboard, con exactamente tres formas (needs_review /
  unsupported / mezcla), cada una singular o plural — nunca una frase
  distinta por combinación exacta de motivos.

### Modelo/lógica

`supplementsNeedingAttention(supplements)` en `supplementUnits.ts` — misma
disciplina que `supplementsNeedingReview()` (Fase 5): pura, evalúa todos los
suplementos **configurados** con `nutrient_key` (nunca los de puro
recuento, que no tienen nada que revisar), independiente de `takenToday`.
Devuelve el `Supplement` emparejado con su `SupplementDoseResult` completo
(`needs_review` o `unsupported`), para que la UI decida el mensaje sin
volver a llamar a `normalizeSupplementDose()`. `supplementsNeedingReview()`
pasa a ser una proyección de esta función (mismo recorrido, nunca dos
implementaciones que puedan divergir) — su comportamiento externo no
cambia, y sus tests de la Fase 5 lo confirman sin tocarlos.

**Confirmado: ningún `unsupported` entra en ningún cálculo.**
`getTodayContributions()`/`getMicroTrends()` (Fase 2, sin tocar en esta
fase) sólo suman `status: 'success'` — exactamente igual antes y después de
esta fase. Esta fase es únicamente de visibilidad.

### Tests (Fase 6)

`supplementUnits.attention.test.ts` (`supplementsNeedingAttention()`,
incluida la fixture de las 34 filas reales), ampliación de
`supplementDoseCopy.test.ts` (`describeUnsupportedBanner`,
`describeAttentionBanner`, `unsupportedAttentionMessage`,
`attentionAccessibilityLabel`), ampliación de `supplementStore.test.ts`
(el banner de Dashboard con `unsupported` tomado/no tomado hoy, y la mezcla
con `needs_review`), y `noDuplicateSupplementCopy.test.ts` actualizado para
la nueva realidad (Diario/Perfil/Dashboard SÍ activan `unsupported` ahora,
a través de las funciones compartidas — ya no a través de un literal
propio). Interacción de navegación: validación manual, mismo límite de
entorno que en fases anteriores.
