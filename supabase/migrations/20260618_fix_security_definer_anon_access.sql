-- Migration: fix_security_definer_anon_access
-- Applied: 2026-06-18
-- Fixes security advisors reported by Supabase linter:
--   - anon can execute SECURITY DEFINER functions via REST API
--   - handle_new_user has mutable search_path
--   - food_cache UPDATE policy was always-true

-- 1. Revoke anon execute on user-scoped SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.copy_day_entries(date, date)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_days_with_data(integer)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_micro_trends(uuid, integer)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_pro_user()                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_streak(uuid, date)         FROM anon;

-- 2. Fix mutable search_path in handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Tighten food_cache UPDATE policy (was USING(true) WITH CHECK(true))
DROP POLICY IF EXISTS "Authenticated users can update cache" ON public.food_cache;

CREATE POLICY "Authenticated users can update cache"
  ON public.food_cache
  FOR UPDATE
  TO authenticated
  USING  (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
