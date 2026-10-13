-- =====================================================================
-- EDRecommend — viewer profiles ("Who's exploring?") + "Love this" rating
-- Safe to run more than once.
--
--   * One login (account) can have up to 5 viewer profiles.
--   * Likes, loves, saves, views and searches belong to ONE profile, so
--     each profile gets its own recommendations.
--   * Row Level Security: an account only ever sees its own profiles, and
--     can only write interactions for profiles it owns.
--   * Existing history moves into each account's first profile.
-- =====================================================================

create table if not exists public.viewer_profiles (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null check (char_length(name) between 1 and 40),
  avatar      text not null default '',          -- an emoji, or '' to show initials
  color       text not null default 'violet',    -- avatar gradient name
  interests   text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists viewer_profiles_account_idx on public.viewer_profiles (account_id);

alter table public.viewer_profiles enable row level security;
drop policy if exists "viewer profiles own" on public.viewer_profiles;
create policy "viewer profiles own" on public.viewer_profiles for all
  using (account_id = auth.uid()) with check (account_id = auth.uid());

-- At most 5 profiles per account.
create or replace function public.limit_viewer_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.viewer_profiles where account_id = new.account_id) >= 5 then
    raise exception 'You can have up to 5 profiles.';
  end if;
  return new;
end;
$$;
drop trigger if exists viewer_profiles_limit on public.viewer_profiles;
create trigger viewer_profiles_limit before insert on public.viewer_profiles
  for each row execute function public.limit_viewer_profiles();

-- Does the signed-in account own this profile? (NULL = account-level row, allowed.)
create or replace function public.owns_viewer_profile(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is null or exists (
    select 1 from public.viewer_profiles where id = pid and account_id = auth.uid()
  );
$$;

-- Interactions and searches belong to a profile.
alter table public.interactions add column if not exists profile_id uuid
  references public.viewer_profiles(id) on delete cascade;
alter table public.searches add column if not exists profile_id uuid
  references public.viewer_profiles(id) on delete cascade;
create index if not exists interactions_profile_idx on public.interactions (profile_id);
create index if not exists searches_profile_idx on public.searches (profile_id);

-- New rating level: "love" (counts more than "like").
alter table public.interactions drop constraint if exists interactions_action_check;
alter table public.interactions add constraint interactions_action_check
  check (action in ('like', 'love', 'dislike', 'view', 'save', 'click'));

-- RLS: still only your own rows, and only for profiles you own.
drop policy if exists "interactions own" on public.interactions;
create policy "interactions own" on public.interactions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.owns_viewer_profile(profile_id));

drop policy if exists "searches own" on public.searches;
create policy "searches own" on public.searches for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.owns_viewer_profile(profile_id));

-- Move existing accounts into a first profile, and their history with them.
insert into public.viewer_profiles (account_id, name, interests)
select p.id, coalesce(nullif(trim(p.name), ''), 'Me'), p.interests
from public.profiles p
where p.onboarded
  and not exists (select 1 from public.viewer_profiles v where v.account_id = p.id);

update public.interactions i set profile_id = v.id
from public.viewer_profiles v
where i.profile_id is null and v.account_id = i.user_id
  and v.created_at = (select min(created_at) from public.viewer_profiles where account_id = i.user_id);

update public.searches s set profile_id = v.id
from public.viewer_profiles v
where s.profile_id is null and v.account_id = s.user_id
  and v.created_at = (select min(created_at) from public.viewer_profiles where account_id = s.user_id);

-- Hardening: trigger functions are never called directly; RLS helpers only for signed-in users.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.limit_viewer_profiles() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.owns_viewer_profile(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.owns_viewer_profile(uuid) to authenticated;
