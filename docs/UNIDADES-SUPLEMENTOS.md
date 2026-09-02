# Unidades de suplementos — Fase 1: `normalizeSupplementDose()`

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

## Qué NO se ha tocado en esta fase (deliberado)

`supplementStore.ts` sigue sumando `dose_amount` sin convertir —
`getTodayContributions()` no llama a `normalizeSupplementDose()` todavía.
`SupplementEditor.tsx`, Dashboard, VeganScore, tendencias, Supabase, el
esquema de `public.supplements` y la PWA no se han modificado. Eso es la
Fase 2 (conectar `getTodayContributions()`/`getMicroTrends()`, con
`needs_review` excluido del sumatorio hasta que el usuario revise la
entrada) y la Fase 3 (UI: filtrado de unidades, conversión en vivo, bloqueo
de combinaciones imposibles), pendientes de aprobación explícita.

## Tests

`src/utils/__tests__/supplementUnits.test.ts` — conversiones exactas,
alias, rechazos (IU incompatible, cápsula/gota con nutriente, unidad y
nutriente desconocidos, cantidad inválida), semántica de plausibilidad
(`needs_review` distinto de `unsupported`, conserva la conversión), y
fixtures basados directamente en las 34 filas reales de producción —
incluida la fila de calcio (150 g → `needs_review` a 150 000 mg, nunca un
cálculo normal).
