-- ═════════════════════════════════════════════════════════════════════════════
-- Blindaje de las columnas de suscripción de public.profiles
--
-- PROBLEMA (P0)
--   La policy de UPDATE de `profiles` es:
--
--     using (auth.uid() = id)
--
--   Al no declarar WITH CHECK, Postgres reutiliza la expresión de USING como
--   check, de modo que un usuario autenticado puede actualizar CUALQUIER
--   columna de su propia fila — incluida `subscription_tier`. Con la anon key
--   (que viaja en el bundle) y su propio JWT, cualquiera puede concederse Pro
--   con un PATCH a la API REST. No es sólo pérdida de ingresos: la Edge
--   Function `analyze-meal` lee ESA MISMA columna para dar 100 análisis de
--   Gemini al día en vez de 1 a la semana, así que es coste directo.
--
-- INVARIANTE QUE ESTABLECE ESTA MIGRACIÓN
--   `subscription_tier`, `subscription_expires_at` y `stripe_customer_id` sólo
--   pueden ser escritas por `service_role` (el webhook de RevenueCat) o por un
--   superusuario. Cualquier otra actualización legítima del perfil sigue
--   funcionando exactamente igual.
--
-- ESTRATEGIA: defensa en profundidad, dos capas independientes en la BD.
--   Capa 1 — privilegios por columna: deniega el intento en la puerta (42501).
--   Capa 2 — trigger BEFORE: revierte el cambio aunque la capa 1 se pierda.
--   La justificación completa y la comparación con las alternativas están en
--   docs/SEGURIDAD-SUSCRIPCION.md.
--
-- NO ES DESTRUCTIVA: no borra datos, no altera la RLS existente, no toca
-- privilegios de SELECT/INSERT/DELETE. Es idempotente: se puede aplicar varias
-- veces sin efectos secundarios.
--
-- Aplicar en Supabase → SQL Editor (o `supabase db push`).
-- Verificar después con supabase/verify-subscription-guard.sql
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- CAPA 1 · Privilegios por columna
--
-- En Postgres el privilegio UPDATE a nivel de tabla cubre TODAS las columnas,
-- así que un `revoke update (col)` no sirve de nada mientras exista el grant de
-- tabla. El patrón correcto es revocar el UPDATE de tabla y volver a concederlo
-- como lista explícita de columnas.
--
-- Es una allowlist deliberada: si mañana se añade una columna sensible a
-- `profiles`, el cliente NO podrá escribirla hasta que alguien la añada aquí
-- conscientemente (fail-closed).
-- ─────────────────────────────────────────────────────────────────────────────

revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;

grant update (
  -- Datos personales editables desde Onboarding y Perfil
  display_name,
  height_cm,
  weight_kg,
  birth_date,
  sex,
  activity_level,
  goal,
  -- Objetivos recalculados en cliente (Mifflin-St Jeor)
  calorie_target,
  protein_target_g,
  carbs_target_g,
  fat_target_g,
  -- Racha: la escribe la RPC `update_streak`. Se concede por precaución porque
  -- la definición de esa función NO está en el repositorio y no podemos
  -- confirmar si es SECURITY DEFINER. Ver docs/SEGURIDAD-SUSCRIPCION.md §
  -- "Pendiente de verificar".
  streak_count,
  last_log_date,
  -- Sello de modificación que añade siempre authStore.updateProfile()
  updated_at
) on public.profiles to authenticated;

-- `anon` no recibe ningún UPDATE: no existe ningún flujo legítimo en el que un
-- usuario sin sesión actualice un perfil.

-- Nota deliberada: NO se tocan los privilegios de INSERT. La fila de `profiles`
-- la crea el flujo de alta (probablemente un trigger SECURITY DEFINER sobre
-- auth.users que no está en este repositorio) y revocar INSERT podría romper el
-- registro de usuarios nuevos. La creación de perfiles queda cubierta por la
-- capa 2, que también actúa en INSERT.

-- ─────────────────────────────────────────────────────────────────────────────
-- CAPA 2 · Trigger de inmutabilidad
--
-- Razón de ser: en Supabase es idiomático (y aparece en incontables snippets)
-- ejecutar `grant all on all tables in schema public to authenticated`. Ese
-- único comando restauraría el UPDATE de tabla y desharía la capa 1 en
-- silencio, sin ningún error. El trigger sobrevive a eso.
--
-- Además, la RLS no puede resolver esto por sí sola: una policy WITH CHECK sólo
-- ve la fila NUEVA, nunca la anterior, así que no puede expresar "esta columna
-- no cambia". El trigger sí tiene OLD y NEW.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_profile_entitlement_guard()
returns trigger
language plpgsql
-- SECURITY INVOKER (el valor por defecto) A PROPÓSITO, no por omisión:
-- necesitamos que `current_user` sea el rol que ejecuta la sentencia. Con
-- SECURITY DEFINER, `current_user` pasaría a ser el propietario de la función
-- y el guard no detectaría jamás a un cliente. No cambiar esto.
set search_path = pg_catalog, pg_temp
as $$
declare
  caller_role text := current_user::text;
  claim_role  text := '';
begin
  -- Rol declarado en el JWT de PostgREST. Segunda señal, por si el cambio de
  -- rol no llegara a aplicarse. Se lee de forma defensiva: fuera de una
  -- petición HTTP el GUC no existe, y podría contener JSON inválido.
  begin
    claim_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    );
  exception when others then
    claim_role := '';
  end;

  -- Sólo `anon` y `authenticated` están restringidos. Son los únicos roles que
  -- puede asumir un cliente: el rol `authenticator` de Supabase sólo tiene
  -- concedidos anon, authenticated y service_role, y este último es el del
  -- webhook. Cualquier otro rol (service_role, postgres, supabase_admin,
  -- migraciones) pasa sin tocar nada.
  if caller_role not in ('anon', 'authenticated')
     and claim_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.subscription_tier is distinct from 'free'
       or new.subscription_expires_at is not null
       or new.stripe_customer_id is not null then
      raise warning
        'profiles: el rol % intentó crear un perfil con datos de suscripción; forzado a free (perfil %)',
        caller_role, new.id;
    end if;
    new.subscription_tier      := 'free';
    new.subscription_expires_at := null;
    new.stripe_customer_id     := null;
    return new;
  end if;

  -- UPDATE: las tres columnas conservan siempre su valor anterior.
  if new.subscription_tier      is distinct from old.subscription_tier
     or new.subscription_expires_at is distinct from old.subscription_expires_at
     or new.stripe_customer_id  is distinct from old.stripe_customer_id then
    raise warning
      'profiles: el rol % intentó modificar columnas de suscripción del perfil %; revertido',
      caller_role, old.id;
  end if;

  new.subscription_tier       := old.subscription_tier;
  new.subscription_expires_at := old.subscription_expires_at;
  new.stripe_customer_id      := old.stripe_customer_id;
  return new;
end;
$$;

comment on function public.enforce_profile_entitlement_guard() is
  'Hace inmutables subscription_tier / subscription_expires_at / stripe_customer_id para los roles de cliente (anon, authenticated). Respaldo de los privilegios por columna. Debe permanecer SECURITY INVOKER.';

drop trigger if exists trg_profiles_entitlement_guard on public.profiles;

create trigger trg_profiles_entitlement_guard
  before insert or update on public.profiles
  for each row
  execute function public.enforce_profile_entitlement_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- Documentación del invariante en el propio esquema
-- ─────────────────────────────────────────────────────────────────────────────

comment on column public.profiles.subscription_tier is
  'Entitlement Pro. SÓLO escribible por service_role (webhook de RevenueCat). Protegido por privilegios de columna + trg_profiles_entitlement_guard. El cliente nunca la escribe.';

comment on column public.profiles.subscription_expires_at is
  'Caducidad del entitlement Pro. SÓLO escribible por service_role (webhook de RevenueCat).';

comment on column public.profiles.stripe_customer_id is
  'Identificador de cliente de facturación. SÓLO escribible por service_role.';

commit;
