-- ============================================================================
--  "מה מבשלים השבוע" — server schema
--
--  Paste this whole file into the Supabase SQL editor and run it once.
--  It is idempotent, so re-running it is safe.
--
--  The server is storage and sync only. The roulette, the cooldown rules and the
--  planning wizard all run on the device — see src/engine/.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
--  Households and membership
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,              -- equals id; keeps every table uniform
  name         text not null default 'המטבח שלנו',
  invite_code  text not null unique,
  settings     jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Membership lookup used by every policy below. SECURITY DEFINER so that reading
-- the membership table from inside a policy cannot recurse into that table's own
-- policy.
create or replace function public.is_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
--  Data tables. Column sets mirror src/types.ts exactly, because the client
--  pushes whole rows.
-- ---------------------------------------------------------------------------

create table if not exists public.dishes (
  id                uuid primary key,
  household_id      uuid not null references public.households(id) on delete cascade,
  name              text not null,
  prep_time_minutes integer not null default 0,
  effort            text not null default 'בינוני',
  tags              jsonb not null default '[]'::jsonb,
  base_servings     integer not null default 2,
  fixed_servings    integer,
  max_cover_days    integer not null default 1,
  ingredients       jsonb not null default '[]'::jsonb,
  is_active         boolean not null default true,
  is_excluded       boolean not null default false,
  image_url         text,
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.components (
  id                uuid primary key,
  household_id      uuid not null references public.households(id) on delete cascade,
  name              text not null,
  type              text not null check (type in ('protein', 'carb', 'veg')),
  prep_time_minutes integer not null default 0,
  base_servings     integer not null default 2,
  ingredients       jsonb not null default '[]'::jsonb,
  is_active         boolean not null default true,
  is_excluded       boolean not null default false,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.week_plans (
  id              uuid primary key,
  household_id    uuid not null references public.households(id) on delete cascade,
  week_start_date date not null,
  planning_params jsonb not null default '{}'::jsonb,
  status          text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table if not exists public.cook_sessions (
  id                uuid primary key,
  household_id      uuid not null references public.households(id) on delete cascade,
  week_plan_id      uuid not null,
  cook_date         date not null,
  source_type       text not null check (source_type in ('dish', 'combo')),
  dish_id           uuid,
  protein_id        uuid,
  carb_id           uuid,
  veg_id            uuid,
  covers_days       integer not null default 1 check (covers_days between 1 and 4),
  servings          integer not null default 2,
  estimated_minutes integer not null default 0,
  is_locked         boolean not null default false,
  is_cooked         boolean not null default false,
  note              text,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.day_slots (
  id              uuid primary key,
  household_id    uuid not null references public.households(id) on delete cascade,
  week_plan_id    uuid not null,
  date            date not null,
  role            text not null default 'empty'
                    check (role in ('cook', 'leftovers', 'none', 'empty')),
  cook_session_id uuid,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table if not exists public.cook_history (
  id           uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  entity_type  text not null check (entity_type in ('dish', 'protein', 'carb', 'veg')),
  entity_id    uuid not null,
  cooked_on    date not null,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.shopping_items (
  id            uuid primary key,
  household_id  uuid not null references public.households(id) on delete cascade,
  week_plan_id  uuid not null,
  name          text not null,
  quantity_text text not null default '',
  aisle         text not null default 'אחר',
  source        text not null default 'auto' check (source in ('auto', 'manual')),
  is_checked    boolean not null default false,
  match_key     text not null default '',
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- The pull query is always "everything in my household changed since X".
create index if not exists dishes_sync_idx         on public.dishes (household_id, updated_at);
create index if not exists components_sync_idx     on public.components (household_id, updated_at);
create index if not exists week_plans_sync_idx     on public.week_plans (household_id, updated_at);
create index if not exists cook_sessions_sync_idx  on public.cook_sessions (household_id, updated_at);
create index if not exists day_slots_sync_idx      on public.day_slots (household_id, updated_at);
create index if not exists cook_history_sync_idx   on public.cook_history (household_id, updated_at);
create index if not exists shopping_items_sync_idx on public.shopping_items (household_id, updated_at);

-- ---------------------------------------------------------------------------
--  Row Level Security
--
--  This is the part that matters. Without it, the anon key that ships in the
--  client bundle would read every household's data. With it, the key can only
--  ever reach rows belonging to a household the signed-in user is a member of.
-- ---------------------------------------------------------------------------

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.dishes            enable row level security;
alter table public.components        enable row level security;
alter table public.week_plans        enable row level security;
alter table public.cook_sessions     enable row level security;
alter table public.day_slots         enable row level security;
alter table public.cook_history      enable row level security;
alter table public.shopping_items    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'dishes', 'components', 'week_plans', 'cook_sessions',
    'day_slots', 'cook_history', 'shopping_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_member_access', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_member(household_id))
         with check (public.is_member(household_id))',
      t || '_member_access', t
    );
  end loop;
end $$;

drop policy if exists households_member_access on public.households;
create policy households_member_access on public.households
  for all to authenticated
  using (public.is_member(id))
  with check (public.is_member(id));

drop policy if exists members_self_read on public.household_members;
create policy members_self_read on public.household_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_member(household_id));

drop policy if exists members_self_leave on public.household_members;
create policy members_self_leave on public.household_members
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
--  Creating and joining a household
--
--  Both run as SECURITY DEFINER: a user who is not yet a member cannot see the
--  household row, so the membership insert has to happen above the policies.
-- ---------------------------------------------------------------------------

create or replace function public.create_household(
  p_id uuid,
  p_name text,
  p_invite_code text,
  p_settings jsonb
)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.households (id, household_id, name, invite_code, settings)
  values (p_id, p_id, p_name, upper(p_invite_code), p_settings)
  on conflict (id) do update set name = excluded.name
  returning * into result;

  insert into public.household_members (household_id, user_id)
  values (result.id, auth.uid())
  on conflict do nothing;

  return result;
end $$;

create or replace function public.join_household(p_invite_code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into target
  from public.households
  where invite_code = upper(trim(p_invite_code))
    and deleted_at is null;

  if target.id is null then
    raise exception 'הקוד לא נמצא';
  end if;

  insert into public.household_members (household_id, user_id)
  values (target.id, auth.uid())
  on conflict do nothing;

  return target;
end $$;

grant execute on function public.create_household(uuid, text, text, jsonb) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
--  Realtime — so one phone's change reaches the other within seconds
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'households', 'dishes', 'components', 'week_plans',
    'cook_sessions', 'day_slots', 'cook_history', 'shopping_items'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
    end;
  end loop;
end $$;
