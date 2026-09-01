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
2. **La policy de INSERT de `profiles`.** No la conocemos. El trigger cubre el
   caso (fuerza `free` en cualquier INSERT hecho por un cliente), pero conviene
   confirmar que el alta de perfiles la hace un trigger `SECURITY DEFINER` sobre
   `auth.users` y no el propio cliente.
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
