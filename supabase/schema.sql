-- =====================================================================
-- EDRecommend — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- It is safe to run more than once.
--
-- Core idea (judges will ask!):
--   * ITEMS are SHARED   — every signed-in user reads the same catalog.
--   * USER DATA is PERSONAL — profiles, interactions and searches are
--     protected by Row Level Security so a user can only ever see and
--     change their own rows. Rahul's likes are never visible to Priya,
--     even if someone edits the JavaScript in their browser, because the
--     database itself refuses the query.
--   * The Python backend uses the SERVICE ROLE key (bypasses RLS) and
--     always filters by the user id taken from a verified JWT.
-- =====================================================================

-- ---------- profiles: one row per auth user ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  username    text unique,
  interests   text[] not null default '{}',
  is_admin    boolean not null default false,
  onboarded   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by policies: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- items: the shared catalog ----------
create table if not exists public.items (
  id           bigint generated always as identity primary key,
  title        text not null,
  category     text not null,
  description  text,
  tags         text[] not null default '{}',
  rating       numeric(4,2),
  image_url    text,
  source       text not null default 'demo',
  created_at   timestamptz not null default now()
);

-- Prevent duplicates: same title (case-insensitive) in the same category.
create unique index if not exists items_title_category_uniq
  on public.items (lower(title), category);
create index if not exists items_category_idx on public.items (category);

-- ---------- interactions: personal history ----------
create table if not exists public.interactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  item_id     bigint not null references public.items(id) on delete cascade,
  action      text not null check (action in ('like','dislike','view','save','click')),
  created_at  timestamptz not null default now()
);
create index if not exists interactions_user_idx on public.interactions (user_id);
create index if not exists interactions_item_idx on public.interactions (item_id);

-- ---------- searches: personal search history ----------
create table if not exists public.searches (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  query       text not null,
  category    text not null default 'All',
  created_at  timestamptz not null default now()
);
create index if not exists searches_user_idx on public.searches (user_id);

-- ---------- imports log (admin view of recent imports) ----------
create table if not exists public.imports (
  id          bigint generated always as identity primary key,
  filename    text not null,
  category    text,
  rows_read   int not null default 0,
  imported    int not null default 0,
  skipped     int not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles     enable row level security;
alter table public.items        enable row level security;
alter table public.interactions enable row level security;
alter table public.searches     enable row level security;
alter table public.imports      enable row level security;

-- profiles: you can only see / edit YOUR OWN profile.
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self read"   on public.profiles for select using (id = auth.uid());
create policy "profiles self insert" on public.profiles for insert with check (id = auth.uid());
-- Users may edit their own row but can never promote themselves to admin.
create policy "profiles self update" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and is_admin = public.is_admin());

-- items: SHARED. Any signed-in user can read; only admins can write.
drop policy if exists "items read"         on public.items;
drop policy if exists "items admin insert" on public.items;
drop policy if exists "items admin update" on public.items;
drop policy if exists "items admin delete" on public.items;
create policy "items read"         on public.items for select to authenticated using (true);
create policy "items admin insert" on public.items for insert to authenticated with check (public.is_admin());
create policy "items admin update" on public.items for update to authenticated using (public.is_admin());
create policy "items admin delete" on public.items for delete to authenticated using (public.is_admin());

-- interactions: PERSONAL. Only your own rows, ever.
drop policy if exists "interactions own" on public.interactions;
create policy "interactions own" on public.interactions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- searches: PERSONAL.
drop policy if exists "searches own" on public.searches;
create policy "searches own" on public.searches for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- imports: admins only.
drop policy if exists "imports admin read" on public.imports;
create policy "imports admin read" on public.imports for select to authenticated using (public.is_admin());

-- =====================================================================
-- Storage: public bucket for item images. Anyone can view, admins upload.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

drop policy if exists "item images public read"  on storage.objects;
drop policy if exists "item images admin write"  on storage.objects;
drop policy if exists "item images admin update" on storage.objects;
create policy "item images public read" on storage.objects for select
  using (bucket_id = 'item-images');
create policy "item images admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-images' and public.is_admin());
create policy "item images admin update" on storage.objects for update to authenticated
  using (bucket_id = 'item-images' and public.is_admin());

-- =====================================================================
-- Make yourself admin (run after you sign up, with your email):
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================
