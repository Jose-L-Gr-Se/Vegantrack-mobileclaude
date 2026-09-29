-- ═════════════════════════════════════════════════════════════════════════════
-- Cierra el vector de INSERT sobre public.profiles
--
-- CONTEXTO (ver docs/SEGURIDAD-SUSCRIPCION.md §10 para el diagnóstico completo)
--
-- supabase/diagnose-insert-policy.sql, ejecutado contra el proyecto real,
-- confirmó un vector que las migraciones anteriores (000000, 000001) no
-- cerraban porque sólo tocaban UPDATE:
--
--   I1  relrowsecurity = true, relforcerowsecurity = false
--   I2  existe la policy "Users can insert own profile", comando INSERT,
--       roles = public, with_check = (auth.uid() = id) — SIN restringir
--       ninguna otra columna.
--   I3  anon Y authenticated tienen privilegio de tabla INSERT sobre profiles.
--   I4  existe on_auth_user_created (AFTER INSERT sobre auth.users) →
--       handle_new_user(), SECURITY DEFINER, propietario postgres.
--   I5  handle_new_user() es:
--         INSERT INTO public.profiles (id) VALUES (NEW.id)
--         ON CONFLICT (id) DO NOTHING;
--       Sólo inserta `id`. Todo lo demás toma su DEFAULT del esquema
--       (subscription_tier DEFAULT 'free'). No lee ningún dato que el
--       cliente controle — ni siquiera pasa por `auth.signUp()`, que sólo
--       maneja email/password.
--
-- Con privilegio de tabla + policy permisiva, un cliente puede ejecutar
-- `INSERT INTO profiles (id, subscription_tier) VALUES (auth.uid(), 'pro')`
-- para SU PROPIO id. Contra un usuario que ya tiene perfil (el caso normal,
-- porque handle_new_user ya se lo creó de forma síncrona durante el propio
-- signUp) el intento choca con la clave primaria y no tiene efecto por sí
-- solo — pero depender de eso es incidental, no estructural: no protege
-- cuentas antiguas sin perfil, ni ningún caso límite futuro. El cliente
-- NUNCA necesita este privilegio: la única vía legítima de creación de
-- perfiles es handle_new_user(), que no pasa por RLS ni por los privilegios
-- de anon/authenticated en absoluto (ver más abajo).
--
-- POR QUÉ REVOCAR INSERT ES SEGURO PARA handle_new_user()
--
-- handle_new_user() es SECURITY DEFINER: durante su ejecución, current_user
-- pasa a ser su propietario — postgres —, no el rol que disparó el INSERT en
-- auth.users. Los privilegios de tabla y las policies de RLS se evalúan
-- contra ESE rol efectivo, nunca contra anon/authenticated. postgres, en el
-- despliegue estándar de Supabase, es superusuario (o como mínimo propietario
-- de public.profiles), así que:
--   - Los GRANT/REVOKE de esta migración no le afectan: un superusuario
--     ignora por completo las comprobaciones de privilegio.
--   - relforcerowsecurity = false (I1) significa que el propietario de la
--     tabla queda exento de RLS por defecto — y un superusuario la salta
--     igualmente, tenga o no relforcerowsecurity activado.
-- Verificar con supabase/verify-subscription-guard.sql (A10): confirma que
-- postgres es superusuario o propietario de profiles antes de dar esto por
-- sentado sólo por convención.
--
-- No se toca `service_role`: nunca ha tenido revocado el privilegio de tabla
-- por ninguna migración de este proyecto, y esta tampoco lo toca.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Revoca INSERT sobre public.profiles a anon y authenticated.
--   2. Retira la policy "Users can insert own profile": sin privilegio de
--      tabla, la policy queda estructuralmente inalcanzable — Postgres
--      comprueba el privilegio de tabla ANTES de evaluar ninguna policy de
--      RLS — así que dejarla sería código muerto que induciría a error a
--      quien lo lea después (exactamente la clase de duplicidad que costó
--      varias rondas de diagnóstico separar en las migraciones anteriores).
--
-- QUÉ NO TOCA
--   - RLS sigue habilitada (no se cambia relrowsecurity/relforcerowsecurity).
--   - Las columnas de suscripción y su protección de UPDATE
--     (protect_subscription_fields_trigger, migración 000001): sin relación
--     con INSERT.
--   - handle_new_user() y su trigger: no se modifican, no hace falta.
--   - service_role.
--
-- Transaccional, no destructiva: no borra ninguna fila, no toca datos.
-- Verificar con supabase/verify-subscription-guard.sql (escenarios 8-9).
-- Revertir con 20260901000004_rollback_close_insert_vector.sql.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

revoke insert on public.profiles from anon, authenticated;

drop policy if exists "Users can insert own profile" on public.profiles;

comment on table public.profiles is
  'INSERT reservado a la creación server-side de perfiles: handle_new_user() '
  '(SECURITY DEFINER, trigger on_auth_user_created sobre auth.users) y '
  'service_role. anon/authenticated no tienen privilegio de tabla INSERT ni '
  'ninguna policy que lo permita. Ver docs/SEGURIDAD-SUSCRIPCION.md §10.';

commit;
