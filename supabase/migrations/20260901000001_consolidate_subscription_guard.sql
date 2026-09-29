-- ═════════════════════════════════════════════════════════════════════════════
-- Consolidación: una única autoridad para el entitlement de profiles
--
-- CONTEXTO (ver docs/SEGURIDAD-SUSCRIPCION.md §6-8 para el diagnóstico completo)
--
-- La migración anterior (20260901000000_protect_subscription_columns.sql)
-- creó `trg_profiles_entitlement_guard` sin saber que ya existía en
-- producción, sin versionar, un mecanismo equivalente:
-- `protect_subscription_fields_trigger` → `protect_subscription_fields()`.
--
-- Diagnóstico confirmado con datos (no supuesto):
--   - `protect_subscription_fields` decide con `auth.role() = 'service_role'`,
--     que lee el claim del JWT que PostgREST fija automáticamente para
--     CUALQUIER petición autenticada, incluida la del webhook de RevenueCat
--     (createClient con la service_role key sin overrides de headers).
--     Verificado contra el camino real, no simulado: D10 mostró que con el
--     claim puesto (el caso real) escribe correctamente en ambas direcciones.
--   - El único hueco real de `protect_subscription_fields` frente al trigger
--     nuevo es que no menciona `stripe_customer_id`. Se cierra aquí.
--   - Mantener los dos triggers no produce valores incorrectos (se ha trazado
--     la ejecución completa), pero sí dos fuentes de verdad independientes
--     gobernando la misma propiedad, con lógicas de decisión distintas
--     (`auth.role()` vs. `current_user`) — exactamente la clase de duplicidad
--     que ya costó dos rondas de diagnóstico separar. Se retira.
--
-- ESTA MIGRACIÓN NO TOCA EL INSERT. `protect_subscription_fields_trigger` es
-- BEFORE UPDATE únicamente, igual que en producción hoy. No se amplía a
-- BEFORE INSERT por decisión deliberada, no por descuido:
--   1. No hay evidencia en este repositorio de que exista un vector de INSERT
--      controlado por el cliente — el esquema de `profiles`, incluida la
--      creación de la fila al registrarse, pertenece a la PWA hermana
--      (README.md, "Backend"), no a este repositorio. Ver
--      supabase/diagnose-insert-policy.sql.
--   2. Añadir `before insert` a una función que referencia `old.*` sin una
--      rama explícita para INSERT (donde OLD no existe) rompería CUALQUIER
--      alta de perfil con un error en tiempo de ejecución. Es exactamente el
--      tipo de cambio especulativo que CLAUDE.md pide evitar sin evidencia
--      de que resuelve un problema real.
--   3. Si `diagnose-insert-policy.sql` revela un vector real, se aborda en una
--      migración propia, deliberada y con sus propios tests — no mezclada
--      aquí bajo presión de consolidar dos triggers de UPDATE.
--
-- SEGURA PARA LA BD EXISTENTE
--   - Transaccional: todo o nada.
--   - No destructiva: no borra filas, no altera columnas, no toca la RLS.
--   - Sin ventana sin protección: se recrea/extiende
--     `protect_subscription_fields` PRIMERO (así stripe_customer_id ya está
--     cubierta) y sólo DESPUÉS se retira el trigger redundante, todo dentro de
--     la misma transacción — nunca hay un instante con menos protección que
--     antes de empezar.
--   - Los privilegios por columna (capa 1) no se tocan: son independientes de
--     cuál de los dos triggers exista.
--   - Requiere ejecutarse con un rol que pueda reemplazar una función
--     propiedad de `postgres` (típicamente el rol con el que el SQL Editor de
--     Supabase ejecuta las sentencias). Si falla por permisos, no deja nada a
--     medias: la transacción entera revierte.
--
-- Verificar después con supabase/verify-subscription-guard.sql (versión
-- actualizada para el trigger consolidado).
-- Revertir con supabase/migrations/20260901000002_rollback_consolidation.sql
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) Versionar y extender la autoridad existente ──────────────────────────
--
-- Cuerpo IDÉNTICO al de producción (confirmado mediante pg_get_functiondef),
-- con una única adición: stripe_customer_id. La lógica de decisión
-- (auth.role() = 'service_role') no cambia — es la que D10 ya validó contra el
-- camino real del webhook.
create or replace function public.protect_subscription_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if auth.role() is distinct from 'service_role' then
        new.subscription_tier = old.subscription_tier;
        new.subscription_expires_at = old.subscription_expires_at;
        new.stripe_customer_id = old.stripe_customer_id;
    end if;
    return new;
end;
$function$;

comment on function public.protect_subscription_fields() is
  'Autoridad ÚNICA sobre subscription_tier / subscription_expires_at / '
  'stripe_customer_id. Sólo auth.role() = ''service_role'' (el webhook de '
  'RevenueCat, vía createClient con la service_role key) puede modificarlas. '
  'Existía en producción antes de este repositorio; versionada y extendida '
  'aquí — el original no cubría stripe_customer_id. '
  'Ver docs/SEGURIDAD-SUSCRIPCION.md §6-8.';

-- Recreación idempotente y explícita: si el trigger ya existe con el mismo
-- cuerpo, esto no cambia su comportamiento; si el proyecto se reconstruye
-- desde cero, esto es lo que lo reproduce.
drop trigger if exists protect_subscription_fields_trigger on public.profiles;

create trigger protect_subscription_fields_trigger
  before update on public.profiles
  for each row
  execute function public.protect_subscription_fields();

-- ── 2) Retirar el mecanismo redundante ───────────────────────────────────────
--
-- Se retira DESPUÉS de que la autoridad consolidada ya está activa: en ningún
-- momento de esta transacción hay una ventana sin ambas columnas protegidas.
drop trigger if exists trg_profiles_entitlement_guard on public.profiles;
drop function if exists public.enforce_profile_entitlement_guard();

-- ── 3) Privilegios por columna (capa 1): sin cambios ────────────────────────
--
-- No se toca ningún GRANT/REVOKE aquí. Siguen siendo correctos e
-- independientes de qué trigger gobierne el entitlement; ya los estableció
-- 20260901000000_protect_subscription_columns.sql.

-- ── 4) Comentarios de columna: apuntar a la autoridad real ──────────────────
comment on column public.profiles.subscription_tier is
  'Entitlement Pro. SÓLO escribible por service_role (webhook de RevenueCat). '
  'Protegido por privilegios de columna + protect_subscription_fields_trigger. '
  'El cliente nunca la escribe.';

comment on column public.profiles.subscription_expires_at is
  'Caducidad del entitlement Pro. SÓLO escribible por service_role (webhook '
  'de RevenueCat). Protegida por protect_subscription_fields_trigger.';

comment on column public.profiles.stripe_customer_id is
  'Identificador de cliente de facturación. SÓLO escribible por service_role. '
  'Protegida por protect_subscription_fields_trigger (antes de esta migración '
  'no lo estaba).';

commit;
