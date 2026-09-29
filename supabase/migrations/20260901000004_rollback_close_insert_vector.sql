-- ═════════════════════════════════════════════════════════════════════════════
-- Reversión de 20260901000003_close_insert_vector.sql
--
-- NO forma parte del despliegue normal. Deshace exactamente lo que hizo esa
-- migración, en orden inverso:
--   1. Recrea la policy "Users can insert own profile", con el mismo
--      with_check exacto capturado en el diagnóstico (auth.uid() = id).
--   2. Vuelve a conceder INSERT sobre profiles a anon y authenticated.
--   3. Restaura el comentario de tabla al estado anterior.
--
-- No toca handle_new_user() ni su trigger: la migración que esto revierte
-- tampoco los tocó.
--
-- Transaccional, no destructiva.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

create policy "Users can insert own profile"
on public.profiles
as permissive
for insert
to public
with check (auth.uid() = id);

grant insert on public.profiles to anon, authenticated;

comment on table public.profiles is
  'Perfiles de usuario. Ver docs/SEGURIDAD-SUSCRIPCION.md.';

commit;
