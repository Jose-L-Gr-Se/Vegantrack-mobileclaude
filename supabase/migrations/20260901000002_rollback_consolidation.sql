-- ═════════════════════════════════════════════════════════════════════════════
-- Reversión de 20260901000001_consolidate_subscription_guard.sql
--
-- NO forma parte del despliegue normal. Es la migración inversa, lista para
-- aplicar SÓLO si hace falta deshacer la consolidación — por ejemplo, si tras
-- desplegarla se descubre algo en `protect_subscription_fields` que no había
-- quedado capturado en el diagnóstico.
--
-- Deshace exactamente lo que hizo 20260901000001, en el orden inverso:
--   1. Recrea trg_profiles_entitlement_guard (el mecanismo que se retiró).
--   2. Devuelve protect_subscription_fields a su forma original de producción
--      (sin stripe_customer_id) — el cuerpo exacto capturado antes de tocar
--      nada, no una reconstrucción.
--   3. Restaura los comentarios de columna al estado de la migración anterior.
--
-- No toca los privilegios por columna (capa 1): nunca los tocó la migración
-- que esto revierte, así que no hay nada que devolver ahí.
--
-- Transaccional y no destructiva, igual que la migración que revierte.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) Devolver protect_subscription_fields a su forma original ────────────
--
-- Cuerpo exacto de producción, capturado con pg_get_functiondef antes de
-- extenderlo (ver docs/SEGURIDAD-SUSCRIPCION.md §6). No cubre
-- stripe_customer_id: es intencionadamente el estado previo, no una mejora.
create or replace function public.protect_subscription_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        NEW.subscription_tier = OLD.subscription_tier;
        NEW.subscription_expires_at = OLD.subscription_expires_at;
    END IF;
    RETURN NEW;
END;
$function$;

comment on function public.protect_subscription_fields() is
  'Protección original (pre-consolidación) de subscription_tier / '
  'subscription_expires_at. No cubre stripe_customer_id.';

-- El trigger en sí no cambia (mismo BEFORE UPDATE de siempre); sólo cambia el
-- cuerpo de la función a la que apunta, ya reemplazado arriba.

-- ── 2) Recrear el mecanismo retirado ─────────────────────────────────────────
create or replace function public.enforce_profile_entitlement_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  caller_role text := current_user::text;
  claim_role  text := '';
begin
  begin
    claim_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    );
  exception when others then
    claim_role := '';
  end;

  if caller_role not in ('anon', 'authenticated')
     and claim_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.subscription_tier      := 'free';
    new.subscription_expires_at := null;
    new.stripe_customer_id     := null;
    return new;
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

-- ── 3) Restaurar los comentarios de columna al estado previo ────────────────
comment on column public.profiles.subscription_tier is
  'Entitlement Pro. SÓLO escribible por service_role (webhook de RevenueCat). Protegido por privilegios de columna + trg_profiles_entitlement_guard. El cliente nunca la escribe.';

comment on column public.profiles.subscription_expires_at is
  'Caducidad del entitlement Pro. SÓLO escribible por service_role (webhook de RevenueCat).';

comment on column public.profiles.stripe_customer_id is
  'Identificador de cliente de facturación. SÓLO escribible por service_role.';

commit;
