-- VeganLens: foto-logueo IA + analítica básica del embudo.
--
-- meal_scans:        un registro por foto analizada con éxito. Sirve para
--                    aplicar la cuota diaria del plan free y para medir uso.
--                    Las escrituras las hace la API con service_role (bypassa RLS);
--                    el cliente sólo necesita leer las suyas.
--
-- analytics_events:  eventos del embudo (signup, foto, paywall, checkout…) para
--                    poder medir activación y conversión. El cliente inserta los
--                    suyos; nadie más los lee desde el cliente.

-- ── meal_scans ──────────────────────────────────────────────────────────────
create table if not exists public.meal_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists idx_meal_scans_user_date on public.meal_scans (user_id, date);

alter table public.meal_scans enable row level security;

drop policy if exists "Users read own meal_scans" on public.meal_scans;
create policy "Users read own meal_scans"
  on public.meal_scans
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.meal_scans is
  'Un registro por foto de plato analizada con IA. Escritura sólo desde la API (service_role); base de la cuota diaria del plan free.';

-- ── analytics_events ────────────────────────────────────────────────────────
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_user_created on public.analytics_events (user_id, created_at);
create index if not exists idx_analytics_event on public.analytics_events (event);

alter table public.analytics_events enable row level security;

drop policy if exists "Users insert own analytics" on public.analytics_events;
create policy "Users insert own analytics"
  on public.analytics_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

comment on table public.analytics_events is
  'Eventos de producto para medir el embudo (activación/retención/conversión). El cliente sólo inserta los suyos.';
