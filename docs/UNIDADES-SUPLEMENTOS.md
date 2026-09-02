# Unidades de suplementos — Fase 1 y Fase 2

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

## Qué NO se ha tocado todavía (deliberado)

`SupplementEditor.tsx` (Fase 3: filtrado de unidades, conversión en vivo,
bloqueo de combinaciones imposibles, aviso de `needs_review` en la UI),
Dashboard/VeganScore/`MicroTrendsScreen` (sin rediseño — sólo reciben datos
ya correctos), Supabase, el esquema de `public.supplements` y la PWA.

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
