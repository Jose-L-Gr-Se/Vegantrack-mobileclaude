# Seguridad del entitlement Pro — `profiles.subscription_tier`

> **Invariante:** `subscription_tier`, `subscription_expires_at` y
> `stripe_customer_id` sólo pueden ser escritas por `service_role`, es decir,
> por el webhook de RevenueCat. Ninguna otra ruta es legítima.

---

## 1. El problema

La policy de UPDATE de `public.profiles` en producción es:

```sql
alter policy "Users can update own profile"
on "public"."profiles"
to public
using (auth.uid() = id);
```

No declara `WITH CHECK`. Cuando se omite, **Postgres reutiliza la expresión de
`USING` como check**, así que la policy sólo restringe *qué fila* se actualiza,
nunca *qué columnas*. Un usuario autenticado puede escribir cualquier columna de
su propia fila.

Con la `anon key` —que viaja en el bundle de la app y es pública por diseño— y
su propio JWT, cualquiera puede hacer:

```
PATCH /rest/v1/profiles?id=eq.<su-uuid>
{ "subscription_tier": "pro", "subscription_expires_at": "2099-01-01" }
```

El impacto no es sólo la pérdida de ingresos:

- `usePro()` (`src/hooks/usePro.ts`) da Pro a quien tenga esa columna en `pro`.
- **`analyze-meal` lee esa misma columna** para conceder 100 análisis de Gemini
  al día en lugar de 1 a la semana → coste directo en la factura de la IA.
- `correct-meal` la usa igualmente para su gate de Pro.

Y la propia app lo hacía explícito: `ProModal` llamaba a
`updateProfile({ subscription_tier: 'pro' })` después de comprar, así que el
camino ya estaba escrito y probado.

---

## 2. Alternativas evaluadas

### A. RLS con `WITH CHECK` — **descartada como mecanismo principal**

La opción intuitiva sería:

```sql
with check (auth.uid() = id and subscription_tier = old.subscription_tier)
```

**No es posible.** Una policy `WITH CHECK` sólo ve la fila **NUEVA**; en RLS no
existe `OLD`. La RLS no puede expresar "esta columna no cambia".

El único apaño sería una subconsulta contra la propia tabla:

```sql
with check (
  auth.uid() = id
  and subscription_tier = (select p.subscription_tier from profiles p where p.id = auth.uid())
)
```

que tiene tres problemas serios:

1. Una policy de `profiles` que consulta `profiles` es el camino directo al
   clásico `infinite recursion detected in policy for relation "profiles"`.
2. Añade un lookup extra por fila en cada actualización de perfil.
3. Depende de sutilezas del snapshot de la sentencia para leer el valor
   anterior: correcto en `READ COMMITTED`, pero frágil de razonar y de mantener.

**Conclusión:** la RLS es la herramienta correcta para *acotar filas* y ya hace
bien ese trabajo (con `USING` como check implícito, un usuario tampoco puede
reasignar el `id` de su fila a otra persona). **Se deja intacta.** No es la
herramienta para inmutabilidad de columna.

### B. Privilegios por columna — **elegida como capa 1**

```sql
revoke update on public.profiles from authenticated;
grant update (display_name, weight_kg, ...) on public.profiles to authenticated;
```

- Es el mecanismo **nativo y declarativo** de Postgres para exactamente este
  problema.
- Se evalúa **antes de tocar ninguna fila**: el intento falla con
  `ERROR 42501: permission denied for table profiles`. Un rechazo duro y
  visible, no un no-op silencioso.

  > **Ojo con ese mensaje.** Postgres informa de los fallos de privilegio de
  > *columna* en sentencias DML **a nivel de tabla**: el ejecutor
  > (`ExecCheckPermissions`) lanza el error con el nombre de la relación, no de
  > la columna. Que diga *table* no significa que falte el `UPDATE` de tabla por
  > error, sino que la sentencia intenta escribir alguna columna sobre la que el
  > rol no tiene privilegio. El SQL Editor de Supabase añade además un HINT
  > sugiriendo `GRANT UPDATE ON public.profiles TO authenticated`: **ese grant es
  > justamente el agujero que esta capa cierra.** No seguir el hint.
- Es una **allowlist**: si mañana se añade una columna sensible a `profiles`,
  el cliente no podrá escribirla hasta que alguien la añada aquí a conciencia
  (*fail-closed*).
- Coste en tiempo de ejecución: cero.

Matiz importante de Postgres: el privilegio `UPDATE` **de tabla** cubre todas las
columnas, así que un `revoke update (columna)` no hace nada mientras el grant de
tabla siga vivo. Hay que revocar el UPDATE de tabla y reconceder la lista
explícita de columnas. La migración lo hace en ese orden.

Punto débil: en Supabase es idiomático ejecutar
`grant all on all tables in schema public to authenticated`. Ese único comando
**restaura el UPDATE de tabla y deshace esta capa sin dar ningún error**.

### C. Trigger `BEFORE UPDATE` — **elegido como capa 2**

Un trigger sí tiene `OLD` y `NEW`, que es justo lo que le falta a la RLS.

- Sobrevive a la regresión descrita en el punto anterior.
- Funciona igual para `INSERT`, cerrando el hueco de crear un perfil ya en `pro`
  (no podemos ver la policy de INSERT desde el repositorio).
- Contra: es imperativo, corre por fila, y puede desactivarse con
  `alter table ... disable trigger`. Por sí solo tampoco *impide* el intento:
  lo revierte, y una escritura que devuelve `200 OK` pero no hace nada es más
  difícil de detectar en los logs que un `403`.

### D. Combinación — **la implementada**

| Capa | Dónde | Qué aporta | De qué protege |
|---|---|---|---|
| 1 | Privilegios por columna | Rechazo duro `42501` antes de tocar la fila | El ataque directo contra la API REST |
| 2 | Trigger `BEFORE INSERT OR UPDATE` | Revierte el valor y registra un `WARNING` | Que alguien restaure el grant de tabla, y el INSERT |
| 3 | Cliente (tipos + saneador) | Error de compilación y filtrado en runtime | Que la app vuelva a escribir la columna por error |
| — | RLS existente | Acota la fila al dueño | Que se edite el perfil de otra persona |

**Por qué esta combinación y no una sola capa:** las capas 1 y 2 fallan de formas
*distintas e independientes*. La 1 se pierde con un `grant` accidental; la 2 se
pierde con un `disable trigger` deliberado. Ninguna de las dos cosas ocurre por
accidente a la vez. La capa 3 no protege nada por sí misma —el cliente es código
que el atacante controla— pero mantiene la app honesta y convierte
`npm run typecheck` en un test de regresión.

---

## 3. Qué se ha implementado

### Base de datos — `supabase/migrations/20260901000000_protect_subscription_columns.sql`

Idempotente, transaccional, no destructiva. No borra datos, no altera la RLS, no
toca SELECT/INSERT/DELETE.

1. `revoke update` de tabla para `anon` y `authenticated`.
2. `grant update (...)` con la lista explícita de 14 columnas legítimas.
3. Función `public.enforce_profile_entitlement_guard()` + trigger
   `trg_profiles_entitlement_guard` sobre `before insert or update`.
4. `comment on column` documentando el invariante en el propio esquema.

**La función debe permanecer `SECURITY INVOKER`** (el valor por defecto). Con
`SECURITY DEFINER`, `current_user` pasaría a ser el propietario de la función y
el guard no detectaría a ningún cliente. Está anotado en el SQL y verificado en
`verify-subscription-guard.sql` (parte A3).

El guard identifica al cliente por `current_user` (el rol efectivo tras el
`SET ROLE` de PostgREST) y, como segunda señal, por el claim `role` del JWT.
Sólo restringe `anon` y `authenticated`: son los únicos roles que el rol
`authenticator` de Supabase puede asumir para una petición de cliente.
`service_role`, `postgres` y las migraciones pasan sin tocar nada.

### Cliente

- **`src/utils/profilePatch.ts`** (nuevo) — define las columnas prohibidas, el
  tipo `EditableProfileFields` y `sanitizeProfilePatch()`.
- **`src/stores/authStore.ts`** — `updateProfile()` acepta
  `Partial<EditableProfileFields>` (pasar `subscription_tier` ya no compila) y
  sanea el patch antes de enviarlo. Importante: también sanea el **set optimista**
  del store, que era lo que pintaba Pro en la UI antes de que el servidor
  respondiera.
- **`src/components/ProModal.tsx`** — eliminadas las dos escrituras de
  entitlement (compra y restauración). En su lugar se llama a `fetchProfile()`.
  La UI no pierde nada: `usePro()` ya da Pro de inmediato a partir del
  `customerInfo` de RevenueCat, que refleja la compra sin pasar por la base de
  datos.

### Tests de regresión

| Fichero | Qué garantiza |
|---|---|
| `src/utils/__tests__/profilePatch.test.ts` | El saneador quita las columnas de suscripción y deja intactos los patches legítimos de onboarding, perfil y peso |
| `src/stores/__tests__/authStore.updateProfile.test.ts` | La carga útil real enviada a Supabase nunca las contiene, ni siquiera saltándose los tipos con `as never`; y la UI no muestra Pro de forma optimista |
| `src/__tests__/noClientEntitlementWrites.test.ts` | Escaneo del código de producción: ningún fichero las usa como clave de objeto, sólo `authStore` habla con `profiles`, y `ProModal` no llama a `updateProfile` |
| `npm run typecheck` | `updateProfile({ subscription_tier })` es un error de compilación |

---

## 4. Cómo aplicarlo

```
Supabase → SQL Editor → pegar y ejecutar:
  supabase/migrations/20260901000000_protect_subscription_columns.sql
```

O con la CLI: `supabase db push`.

Después, verificar con `supabase/verify-subscription-guard.sql` (sustituyendo
`<UUID_DE_PRUEBA>` por el id de un perfil de pruebas).

El script está dividido en tres partes. La **parte A** son consultas de sólo
lectura sobre la configuración. La **parte B** es el veredicto: un único bloque
que devuelve una tabla de cinco filas con `PASA` / `FALLA` por escenario. La
**parte C** es la red de seguridad posterior.

Cada escenario de la parte B corre dentro de su propia subtransacción con
manejador de excepciones. Esto no es un adorno: el escenario del ataque **debe**
terminar en error 42501, y el SQL Editor de Supabase aborta el script entero en
el primer error. Una versión lineal nunca llegaba a ejecutar los escenarios
siguientes y parecía un script roto justo cuando la defensa estaba funcionando.

El escenario 3 necesita conceder temporalmente `update on public.profiles to
authenticated` para reproducir la regresión. Ese `GRANT` vive dentro de una
subtransacción que **siempre** aborta, dentro de una transacción que además
termina en `ROLLBACK`, y la parte C vuelve a comprobar que no ha sobrevivido.
Ningún permiso de producción se modifica.

**Orden recomendado:** desplegar primero la app con estos cambios y después
aplicar el SQL. No es obligatorio —el orden inverso también funciona— pero evita
que una versión antigua reciba errores `42501` innecesarios (ver §5).

---

## 5. Efecto sobre las versiones ya publicadas

Las builds que ya están en dispositivos de usuarios siguen llamando a
`updateProfile({ subscription_tier: 'pro' })` después de comprar. Tras aplicar la
migración, esa llamada devolverá `42501`.

**No rompe la compra.** En el código de `ProModal`, el resultado de
`updateProfile` no se comprueba: el modal se cierra igual, y el usuario sigue
viendo Pro porque `usePro()` lo deriva del `customerInfo` de RevenueCat. El
webhook escribe el valor real en `profiles` en segundo plano. El único efecto es
una escritura fallida y silenciosa en clientes antiguos.

---

## 6. Escenario 5: la degradación a free no se aplicaba

Al ejecutar la verificación contra el proyecto real salió `1-4 PASA`, `5 FALLA`:
`service_role` intentó bajar `subscription_tier` de `pro` a `free` y el valor se
quedó en `pro`.

### El veredicto era engañoso: dos defectos del script de verificación

**Defecto 1 — el escenario 4 podía aprobar en vacío.** Comprobaba el estado
final (`v_ok := (v_tier_fin = 'pro')`) sin compararlo con el valor de partida.
Sobre un perfil que **ya estaba en `pro`**, aprobaba aunque el `UPDATE` no
hubiera hecho absolutamente nada. Un test que aprueba sin que ocurra nada no es
un test.

**Defecto 2 — el inventario de triggers sólo miraba el nuestro.** La consulta
filtraba `and t.tgname = 'trg_profiles_entitlement_guard'`, así que cualquier
*otro* trigger sobre `profiles` —justo la clase de conflicto que hay que
descartar aquí— quedaba invisible.

Corolario importante: los escenarios 4 y 5 ejecutan el mismo código con el mismo
rol, la misma tabla, las mismas columnas y los mismos privilegios. **No hay
ningún mecanismo por el que `service_role` pueda escribir `'pro'` en el 4 y
fallar al escribir `'free'` en el 5.** La única lectura internamente coherente
es que *ninguno de los dos escribió nada*, y que el 4 aprobó en vacío porque el
perfil ya era `pro`. Es decir: **no tenemos ninguna evidencia de que
`service_role` pueda escribir la columna**, y el escenario 5 es el único que lo
destapó.

### Tres causas candidatas, y cómo distinguirlas

Cuál de las tres es no se puede deducir del repositorio: depende del estado real
de la base de datos. `supabase/diagnose-subscription-guard.sql` las separa con
datos, usando `ROW_COUNT` como discriminador:

| Observación | Causa |
|---|---|
| `filas_afectadas = 0` | La RLS filtra la fila para `service_role` (`auth.uid()` es NULL sin JWT y la policy es `auth.uid() = id`). No es ningún trigger. Ver `rolbypassrls` en D5. |
| `1 fila`, valor sin cambiar con nuestro guard activo, **sí** cambia con el guard desactivado | La causa es **nuestro** trigger: `claim_role` está demotando a `service_role`. Ver abajo. |
| `1 fila`, valor sin cambiar en **ambos** casos | Hay **otro** trigger `BEFORE UPDATE` sobre `profiles` revirtiéndolo. Los triggers disparan en orden alfabético, así que uno cuyo nombre vaya después de `trg_profiles_entitlement_guard` sobrescribe lo que nosotros dejamos pasar. Ver D2/D3. |

### La debilidad de diseño que sí podemos afirmar

Independientemente de cuál sea la causa aquí, la condición del guard tiene un
fallo de diseño:

```sql
if caller_role not in ('anon', 'authenticated')
   and claim_role  not in ('anon', 'authenticated') then
  return new;
end if;
```

Es un **AND de dos negaciones**: basta con que `request.jwt.claims` contenga
`"role":"authenticated"` para que el guard trate al escritor como cliente
**aunque `current_user` sea `service_role`**. El claim del JWT puede *degradar* a
un `current_user` legítimo, y eso está al revés: `current_user` es el rol que
Postgres ha establecido de verdad y debe ser la autoridad. El claim aporta
seguridad casi nula (PostgREST siempre hace el `SET ROLE`; sin él el rol sería
`authenticator`, que no tiene privilegios) y a cambio abre esta superficie de
falsos positivos.

**Corrección propuesta** (pendiente de confirmar con el diagnóstico antes de
escribir la migración):

```sql
-- current_user manda. El claim sólo restringe cuando el rol efectivo es
-- `authenticator`, es decir, cuando el SET ROLE no llegó a aplicarse.
if caller_role not in ('anon', 'authenticated')
   and not (caller_role = 'authenticator' and claim_role in ('anon', 'authenticated'))
then
  return new;
end if;
```

Esto mantiene A, B, E y F intactas y devuelve C y D.

### Qué se ha corregido ya (sin tocar la base de datos)

- `verify-subscription-guard.sql`: los escenarios 4 y 5 comprueban ahora una
  **transición observada** (`free → pro` y `pro → free`), informan de
  `ROW_COUNT` y no pueden aprobar en vacío. El inventario A3 lista **todos** los
  triggers de `profiles` con su momento, eventos y orden de disparo.
- `diagnose-subscription-guard.sql` (nuevo): D1-D6 de sólo lectura y D7, el
  experimento decisivo que ejecuta la escritura como `service_role` con nuestro
  guard activo y desactivado, dentro de una transacción con `ROLLBACK`.
- Tests de regresión: `src/__tests__/verifyScriptIntegrity.test.ts` impide que
  vuelvan los dos defectos; `src/utils/__tests__/proEntitlement.test.ts` fija la
  semántica del entitlement.

**No se ha modificado nada en Supabase.** El arreglo del trigger espera a la
salida del diagnóstico.

### Por qué esto importa más de lo que parece

El handler de `EXPIRATION` escribe **dos** columnas:

```ts
.update({ subscription_tier: 'free', subscription_expires_at: null, ... })
```

Y `hasProfilePro()` interpreta una caducidad nula como *"no caduca nunca"*. Si la
escritura del `tier` se pierde y la de la fecha no, el usuario pasa de
*"Pro hasta el día X"* a **Pro para siempre**. Una degradación que falla no es
neutra: mejora silenciosamente el entitlement. Queda fijado en
`src/utils/__tests__/proEntitlement.test.ts`.

---

## 7. Pendiente de verificar (no está en el repositorio)

Estas cosas no se pueden comprobar desde el código y conviene revisarlas en el
panel de Supabase:

1. **La RPC `update_streak`.** No está en el repositorio. Si es
   `SECURITY INVOKER`, corre como `authenticated` y necesita UPDATE sobre
   `streak_count` y `last_log_date`: por eso ambas columnas están en la
   allowlist. Si se confirma que es `SECURITY DEFINER`, **deberían quitarse del
   grant**, porque el cliente no tiene ningún motivo legítimo para escribir su
   propia racha (hoy puede).
2. ~~**La policy de INSERT de `profiles`.**~~ Investigado en §9 — ver el
   diagnóstico completo allí. Conclusión corta: ningún código cliente (ni el de
   esta app ni el de la PWA) inserta nunca en `profiles`; la policy/privilegio
   real de INSERT en la base de datos sigue pendiente de confirmar con
   `supabase/diagnose-insert-policy.sql`, pero el vector por el que se llegó a
   esta investigación (que la app cliente pudiera crear su propio perfil ya en
   `pro`) queda descartado por el propio código de ambas apps.
3. **Columnas reales de la tabla.** La allowlist se ha construido a partir de
   `src/types/index.ts` y de los callers de `updateProfile()`. Si la tabla en
   producción tiene columnas que el cliente escribe y que no están en el tipo de
   TypeScript, faltarían en el grant. Comprobar con:

   ```sql
   select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
   order by ordinal_position;
   ```

4. **Auditoría de daños previos.** Antes de este arreglo cualquiera pudo
   concederse Pro. Merece la pena cruzar los perfiles en `pro` con las compras
   reales de RevenueCat:

   ```sql
   select id, subscription_tier, subscription_expires_at, updated_at
   from public.profiles
   where subscription_tier = 'pro'
   order by updated_at desc;
   ```

---

## 8. Si en el futuro hay que añadir una columna que el cliente escriba

1. Añadirla al `grant update (...)` de una **nueva** migración (no editar la ya
   aplicada).
2. Comprobar que no está en `CLIENT_READONLY_PROFILE_COLUMNS`
   (`src/utils/profilePatch.ts`).
3. `npm test && npm run typecheck`.

Si lo que hay que añadir es otra columna **de entitlement**, va al revés: se
añade a `ENTITLEMENT_PROFILE_COLUMNS`, al trigger y a los `comment on column`,
y **no** al grant.

---

## 9. Consolidación: una única autoridad de entitlement

Tras aplicar §§1-8, la verificación contra el proyecto real (no simulada)
mostró `1-4 PASA / 5 FALLA`: `service_role` no podía degradar `pro → free`.
La investigación de esa discrepancia —completa en el historial de este
documento y en los commits de `supabase/diagnose-subscription-guard.sql`—
llevó a un hallazgo mayor: **ya existía en producción, sin versionar, una
protección equivalente**, `protect_subscription_fields_trigger` →
`protect_subscription_fields()`, creada directamente en el SQL Editor antes de
que este repositorio existiera.

```sql
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        NEW.subscription_tier = OLD.subscription_tier;
        NEW.subscription_expires_at = OLD.subscription_expires_at;
    END IF;
    RETURN NEW;
END;
$function$
```

### 9.1 Análisis del webhook real

`revenuecat-webhook/index.ts` crea el cliente así:

```ts
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
```

Sin tercer argumento `options`, sin `global.headers`. Es el comportamiento por
defecto de `@supabase/supabase-js`: fija `Authorization: Bearer
<service_role_key>` en cada petición. La `service_role_key` **es** un JWT
firmado con el secreto del proyecto y con el claim `"role":"service_role"`
dentro. PostgREST, al recibir esa petición, decodifica el JWT, hace `SET ROLE
service_role` y **también** vuelca el payload en el GUC `request.jwt.claims`
—comportamiento estándar suyo para cualquier JWT válido, no algo que haya que
configurar aparte.

`auth.role()` lee exactamente ese GUC. Así que para la llamada real del
webhook, `auth.role()` devuelve `'service_role'` de forma correcta y
automática. Confirmado con datos, no supuesto: el experimento D10
(`supabase/diagnose-subscription-guard.sql`) replicó ese claim exacto y
`protect_subscription_fields` dejó pasar la escritura en ambas direcciones.
**El webhook nunca ha estado fallando en producción** — el `FALLA` original
era un artefacto de cómo probamos nosotros en el SQL Editor (`set local role
service_role` sin fijar ningún claim), no del comportamiento real.

### 9.2 Comparación de los dos triggers

| | `protect_subscription_fields_trigger` (existente) | `trg_profiles_entitlement_guard` (retirado) |
|---|---|---|
| Se dispara | `BEFORE UPDATE` | `BEFORE INSERT OR UPDATE` |
| Orden de disparo | 1º (alfabético: `p` < `t`) | 2º |
| Decide por | `auth.role()` (claim del JWT) | `current_user`, claim como refuerzo |
| Columnas que protegía | `subscription_tier`, `subscription_expires_at` | + `stripe_customer_id` |
| `SECURITY` | `DEFINER`, propietario `postgres` | `INVOKER` |
| Versionado en el repo | No, hasta esta sección | Sí, desde el principio |

Trazada la ejecución completa para ambos órdenes de escritura (`service_role`
legítimo y `authenticated` en el escenario de regresión), **ningún caso produce
un valor incorrecto**: cuando coexistían, el segundo trigger en dispararse
encontraba las columnas ya en su valor correcto y no hacía nada, salvo para
`stripe_customer_id`, que sólo cubría el trigger retirado. El problema nunca
fue de corrección — fue que dos mecanismos independientes, con lógicas de
decisión distintas, gobernaban la misma propiedad, lo que costó dos rondas de
diagnóstico separar "no escribe por A" de "no escribe por B".

Quirk documentado, no corregido (no forma parte de esta migración):
`auth.role()` fuera de una petición HTTP —por ejemplo, `postgres` corrigiendo
un dato a mano en el SQL Editor sin fijar `request.jwt.claims`— devuelve
`NULL`, y `NULL IS DISTINCT FROM 'service_role'` es `TRUE`. Una corrección
manual así también se revertiría, salvo que se fije el claim a mano (como en
D10b). Tenlo presente el día que necesites tocar un dato a mano.

### 9.3 Diagnóstico de INSERT

Pregunta abierta antes de escribir la migración definitiva: ¿existe un vector
por el que un cliente pudiera crear su propio perfil ya en `pro`?

**Lo que confirma el código, en las DOS bases de código** (esta app y la PWA
hermana, clonada para esta comprobación desde
`github.com/Jose-L-Gr-Se/vegantrack`):

- Ningún fichero de ninguna de las dos apps ejecuta `.from('profiles').insert(...)`.
- `authStore.signUp()` en ambas apps es, literalmente, `supabase.auth.signUp({email,
  password})` y nada más — ni una llamada adicional que cree la fila.
- El README de este repositorio ya lo documentaba: *"No hay esquema nuevo: la
  app usa las tablas existentes del proyecto Supabase de la PWA"* — el alta de
  perfiles no es responsabilidad de ningún código cliente que controlemos.
- `schema.sql` de la PWA está explícitamente marcado *"for context only and is
  not meant to be run"*: es un volcado de tablas sin funciones, triggers ni
  policies, así que tampoco resuelve la pregunta por sí solo.

**Hallazgo colateral, fuera de alcance de esta tarea:** el `updateProfile()` de
la PWA tiene exactamente el mismo patrón que tenía el de esta app antes de
`sanitizeProfilePatch()` — envía el `patch` completo sin filtrar
(`src/stores/authStore.ts` de la PWA). Hoy ningún componente de su UI le pasa
`subscription_tier` (comprobado: sólo se *lee* en su `usePro`), así que no es
explotable *ahora mismo*, pero es la misma clase de riesgo latente que
motivó todo este trabajo aquí. No se ha tocado la PWA — es un repositorio
aparte, sólo clonado en modo lectura para este diagnóstico — pero merece su
propio arreglo si alguien retoma ese proyecto.

**Lo que NO puede confirmarse desde ningún repositorio de cliente:** si
`authenticated` tiene privilegio de tabla `INSERT` sobre `profiles` y si existe
una policy de RLS que lo permita. Eso es configuración de la base de datos, no
de ningún código cliente — ninguna cantidad de lectura de repositorios lo
resuelve. `supabase/diagnose-insert-policy.sql` (íntegramente de sólo lectura,
sin necesidad de `ROLLBACK` porque no escribe nada) responde a las 6 preguntas
restantes con metadatos del catálogo de Postgres, sin necesidad de intentar
ningún `INSERT` real.

**Conclusión y decisión:** con dos bases de código independientes descartando
el vector "la app legítima inserta perfiles con datos del cliente", el riesgo
residual es mucho menor de lo que parecía al plantear la pregunta. La
migración definitiva (§9.4) **no toca el `INSERT`**, por una razón que no es
sólo "falta evidencia": `protect_subscription_fields` referencia `OLD.*`, y en
un trigger `BEFORE INSERT` no existe fila `OLD` — añadir `INSERT` a su alcance
sin una rama dedicada (como sí tenía `enforce_profile_entitlement_guard`)
**rompería el alta de cualquier perfil** con un error en tiempo de ejecución.
Es exactamente la clase de cambio especulativo que `CLAUDE.md` pide evitar sin
evidencia de que resuelve un problema real. Si `diagnose-insert-policy.sql`
revela un vector real, se aborda en una migración propia y deliberada — nunca
mezclada aquí bajo la presión de consolidar dos triggers de `UPDATE`.

### 9.4 Arquitectura final

| Capa | Mecanismo | Único dueño |
|---|---|---|
| 1 | Privilegios por columna | `authenticated`/`anon` sin `UPDATE` sobre las 3 columnas |
| 2 | `protect_subscription_fields_trigger` (extendido) | `auth.role() = 'service_role'` es la única condición que deja pasar un cambio |

Migraciones:

- **`supabase/migrations/20260901000001_consolidate_subscription_guard.sql`** —
  versiona y extiende `protect_subscription_fields` (añade `stripe_customer_id`,
  conserva la condición `auth.role()` validada contra el camino real), retira
  `trg_profiles_entitlement_guard` + `enforce_profile_entitlement_guard`,
  actualiza los `comment on column`. Transaccional, no destructiva, no toca la
  capa 1 ni el `INSERT`. Todo en una única transacción: la autoridad
  consolidada queda activa **antes** de retirar la redundante, así que nunca
  hay una ventana sin protección.
- **`supabase/migrations/20260901000002_rollback_consolidation.sql`** —
  reversión exacta: devuelve `protect_subscription_fields` a su forma original
  (sin `stripe_customer_id`) y recrea el mecanismo retirado. No forma parte del
  despliegue normal; sólo se aplica si hiciera falta deshacer la consolidación.

### 9.5 Riesgos de aplicar la consolidación

- **Privilegio para reemplazar una función `postgres`-owned.**
  `protect_subscription_fields` es propiedad de `postgres`. Aplicar la
  migración exige un rol con privilegio sobre ese objeto — normalmente el que
  usa el SQL Editor de Supabase. Si falta, la sentencia falla con un error de
  permiso explícito y la transacción entera revierte; no hay estado intermedio.
- **Lock breve.** `DROP TRIGGER`/`CREATE TRIGGER` piden `ACCESS EXCLUSIVE`
  sobre `profiles` durante la DDL — milisegundos en la práctica, pero conviene
  aplicarla en tráfico bajo por higiene.
- **No hay ventana sin protección**, por el orden dentro de la transacción
  (§9.4). Si cualquier sentencia falla, nada de la migración queda aplicado.
- **El `INSERT` queda con la cobertura que tenía antes de este repositorio**
  —ninguna—, no una regresión respecto al estado *anterior a toda esta tarea*,
  pero sí respecto a lo que `trg_profiles_entitlement_guard` cubría mientras
  existió. Ver la decisión razonada en §9.3.
- **Es DDL confirmada, no un `ROLLBACK` de sesión.** Deshacerla en producción
  exige aplicar la migración inversa (§9.4), no basta con cerrar la conexión.

### 9.6 Procedimiento de despliegue

1. Confirmar que `20260901000000_protect_subscription_columns.sql` ya está
   aplicada (lo está, según la verificación de §4).
2. Opcional pero recomendado: ejecutar `supabase/diagnose-insert-policy.sql`
   (sólo lectura) y guardar el resultado, por si algún día hace falta decidir
   sobre el `INSERT`.
3. Supabase → SQL Editor → pegar y ejecutar
   `supabase/migrations/20260901000001_consolidate_subscription_guard.sql`
   entero. Termina en `COMMIT`: si no hay errores, queda aplicada.
4. Ejecutar `supabase/verify-subscription-guard.sql` (versión actualizada para
   la arquitectura consolidada y para el cierre del vector de INSERT, §10):
   Parte A entera, luego Parte B seleccionada entera de una vez, luego Parte C.
   Esperado: las 9 filas de la Parte B en `PASA`.
5. Si algo falla: NO seguir depurando en producción. Aplicar
   `20260901000002_rollback_consolidation.sql` entero, confirmar con la Parte A
   del script de verificación (debe volver a verse `trg_profiles_entitlement_guard`),
   y traer el resultado aquí antes de reintentar.

---

## 10. Cierre del vector de INSERT

`supabase/diagnose-insert-policy.sql`, ejecutado contra el proyecto real,
confirmó un vector que §§1-9 no cerraban: sólo se había protegido `UPDATE`.

| Consulta | Resultado |
|---|---|
| I1 | `relrowsecurity = true`, `relforcerowsecurity = false` |
| I2 | Policy `"Users can insert own profile"`, comando `INSERT`, roles `public`, `with_check = (auth.uid() = id)` — sin restringir ninguna otra columna |
| I3 | `anon` **y** `authenticated` tienen privilegio de tabla `INSERT` sobre `profiles` |
| I4 | Trigger `on_auth_user_created` (`AFTER INSERT` sobre `auth.users`) → `handle_new_user()`, `SECURITY DEFINER`, propietario `postgres` |
| I5 | `handle_new_user()` es literalmente `INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;` |

Con privilegio de tabla y una policy que sólo mira el `id`, un cliente puede
ejecutar `INSERT INTO profiles (id, subscription_tier) VALUES (auth.uid(),
'pro')` para su propio `id`. Contra un usuario que ya tiene perfil —el caso
normal, porque `handle_new_user` ya se lo creó de forma síncrona durante el
propio `signUp()`— el intento choca con la clave primaria y no tiene efecto
por sí solo. Pero depender de eso es **incidental, no estructural**: no
protege cuentas antiguas sin perfil ni ningún caso límite futuro, y el cliente
nunca necesita ese privilegio en absoluto.

### 10.1 Por qué revocar INSERT es seguro para `handle_new_user()`

`handle_new_user()` es `SECURITY DEFINER`: durante su ejecución, `current_user`
pasa a ser su propietario —`postgres`—, no el rol que disparó el `INSERT` en
`auth.users`. Los privilegios de tabla y las policies de RLS se evalúan contra
ESE rol efectivo, nunca contra `anon`/`authenticated`. En el despliegue
estándar de Supabase, `postgres` es superusuario (o como mínimo propietario de
`public.profiles`), así que:

- Los `GRANT`/`REVOKE` de esta migración no le afectan: un superusuario ignora
  por completo las comprobaciones de privilegio.
- `relforcerowsecurity = false` (I1) exime al propietario de la tabla de la
  RLS por defecto — y un superusuario la salta igualmente.

No se da esto por sentado sólo por convención: `verify-subscription-guard.sql`
A10 comprueba explícitamente `rolsuper` de `postgres` y si es propietario de
`profiles`, para confirmarlo contra el proyecto real en el momento de aplicar.

**Otras rutas legítimas de INSERT, descartadas por inspección:** ninguna Edge
Function de este repositorio inserta en `profiles` (comprobado); `I6` de
`diagnose-insert-policy.sql` (búsqueda de cualquier otra función `SECURITY
DEFINER` que inserte en `profiles`) no usa ningún agregado y no puede producir
el error `42809` — si al ejecutarlo se ve ese error, es casi seguro una
confusión con `diagnose-subscription-guard.sql` (D6 sigue teniendo el patrón
`unnest`/`string_agg` sin corregir; fuera del alcance pedido en su momento).
`delete-account` documenta explícitamente `ON DELETE CASCADE` en `profiles`:
ni siquiera el borrado de cuenta deja una fila huérfana reutilizable.

### 10.2 Qué hace la migración, y qué no toca

`supabase/migrations/20260901000003_close_insert_vector.sql`:

1. `revoke insert on public.profiles from anon, authenticated;`
2. `drop policy if exists "Users can insert own profile" on public.profiles;`
   — sin privilegio de tabla, la policy queda estructuralmente inalcanzable
   (Postgres comprueba el privilegio de tabla **antes** de evaluar ninguna
   policy de RLS), así que dejarla sería código muerto capaz de inducir a
   error a quien lo lea después.

No toca: RLS (sigue habilitada), las columnas de suscripción ni su protección
de `UPDATE` (migración 000001, sin relación con `INSERT`), `handle_new_user()`
ni su trigger, ni `service_role` (nunca tuvo revocado el privilegio de tabla).

Migración independiente de 000001/000002: gobierna un vector distinto
(`INSERT` vs. `UPDATE`) y puede aplicarse en cualquier orden respecto a ellas,
aunque se recomienda el orden numérico por coherencia con el orden en que se
descubrieron los problemas.

Rollback: `supabase/migrations/20260901000004_rollback_close_insert_vector.sql`
— recrea la policy con el `with_check` exacto capturado y vuelve a conceder el
privilegio de tabla a ambos roles.

### 10.3 Procedimiento de despliegue

1. Aplicar `20260901000000` y `20260901000001` si aún no lo están (ver §4 y
   §9.6).
2. Supabase → SQL Editor → pegar y ejecutar entero
   `20260901000003_close_insert_vector.sql`. Termina en `COMMIT`.
3. Ejecutar `verify-subscription-guard.sql` completo: Parte A (incluye A6-A10,
   nuevas) → Parte B seleccionada entera → Parte C. Esperado: **9 filas en
   `PASA`**, con especial atención a A10 (`postgres` superusuario o
   propietario de `profiles`) y a los escenarios 8-9.
4. Verificación de extremo a extremo, fuera de SQL: registrar un usuario nuevo
   de verdad a través de la app (no simulado en el editor — crear una fila en
   `auth.users` desde SQL tiene efectos secundarios sobre los que no hay
   control, como triggers de email; no se hace aquí) y confirmar que recibe su
   `profiles` con `subscription_tier = 'free'`.
5. Si algo falla: aplicar `20260901000004_rollback_close_insert_vector.sql`
   entero, confirmar con la Parte A (debe reaparecer la policy y el privilegio
   de tabla), y traer el resultado aquí antes de reintentar.
