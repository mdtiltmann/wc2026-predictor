-- ─── WC2026 Predictor — Supabase SQL Schema ───────────────────────────────────
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query → Run

-- ─── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Teams ────────────────────────────────────────────────────────────────────
create table if not exists public.teams (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  code       text not null unique,   -- e.g. "ENG", "BRA"
  flag_url   text,                   -- optional CDN url for flag image
  created_at timestamptz default now()
);

-- ─── Matches ──────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id             uuid primary key default uuid_generate_v4(),
  kickoff        timestamptz not null,
  stadium        text,
  round          text not null,      -- e.g. "Group Stage", "Quarter-Final"
  group_name     text,               -- e.g. "Group A" (null for knockout rounds)
  status         text not null default 'upcoming'
                   check (status in ('upcoming','live','finished','postponed')),
  home_team_id   uuid not null references public.teams(id),
  away_team_id   uuid not null references public.teams(id),
  home_score     int,
  away_score     int,
  external_id    text unique,        -- id from the scores API (for syncing)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ─── Leagues ──────────────────────────────────────────────────────────────────
create table if not exists public.leagues (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  code       text not null unique,   -- short invite code, e.g. "MIKE26"
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ─── League membership ────────────────────────────────────────────────────────
create table if not exists public.league_members (
  league_id  uuid not null references public.leagues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz default now(),
  primary key (league_id, user_id)
);

-- ─── Predictions ──────────────────────────────────────────────────────────────
create table if not exists public.predictions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  league_id       uuid not null references public.leagues(id) on delete cascade,
  match_id        uuid not null references public.matches(id) on delete cascade,
  predicted_home  int not null check (predicted_home >= 0),
  predicted_away  int not null check (predicted_away >= 0),
  joker           boolean not null default false,
  submitted_at    timestamptz default now(),
  unique (user_id, league_id, match_id)   -- one prediction per user per match per league
);

-- ─── Scores (computed after match finishes) ───────────────────────────────────
create table if not exists public.scores (
  id               uuid primary key default uuid_generate_v4(),
  prediction_id    uuid not null unique references public.predictions(id) on delete cascade,
  points_awarded   int not null default 0,
  score_breakdown  jsonb,            -- { exact, correctResult, correctDiff, joker }
  computed_at      timestamptz default now()
);

-- ─── User profiles (display name + avatar, extends auth.users) ────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  avatar_url  text,
  updated_at  timestamptz default now()
);

-- ─── Leaderboard view ─────────────────────────────────────────────────────────
-- The app queries: /leaderboard?league_id=eq.{id}&order=rank.asc
create or replace view public.leaderboard as
select
  lm.league_id,
  p.id                                              as user_id,
  pr.name,
  pr.avatar_url,
  coalesce(sum(sc.points_awarded), 0)               as total_points,
  count(*) filter (where sc.points_awarded >= 5)    as exact_scores,
  count(*) filter (where sc.points_awarded > 0)     as correct_results,
  count(pred.id)                                    as predictions_made,
  rank() over (
    partition by lm.league_id
    order by coalesce(sum(sc.points_awarded), 0) desc
  )                                                 as rank
from public.league_members lm
join auth.users            p    on p.id = lm.user_id
join public.profiles       pr   on pr.id = p.id
left join public.predictions pred
  on pred.user_id = lm.user_id and pred.league_id = lm.league_id
left join public.scores sc
  on sc.prediction_id = pred.id
group by lm.league_id, p.id, pr.name, pr.avatar_url;

-- ─── Auto-update matches.updated_at ───────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger matches_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

-- ─── Auto-create profile on signup ────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Row Level Security ───────────────────────────────────────────────────────

alter table public.teams          enable row level security;
alter table public.matches        enable row level security;
alter table public.leagues        enable row level security;
alter table public.league_members enable row level security;
alter table public.predictions    enable row level security;
alter table public.scores         enable row level security;
alter table public.profiles       enable row level security;

-- Teams & matches: anyone logged in can read
create policy "teams_read"   on public.teams   for select using (auth.role() = 'authenticated');
create policy "matches_read" on public.matches for select using (auth.role() = 'authenticated');

-- Leagues: members can read; anyone can create
create policy "leagues_read"   on public.leagues for select using (
  exists (select 1 from public.league_members where league_id = id and user_id = auth.uid())
);
create policy "leagues_insert" on public.leagues for insert with check (auth.uid() = created_by);

-- League members: members can read their own league's roster
create policy "members_read" on public.league_members for select using (
  exists (select 1 from public.league_members lm2 where lm2.league_id = league_id and lm2.user_id = auth.uid())
);
create policy "members_join" on public.league_members for insert with check (auth.uid() = user_id);

-- Predictions: users manage their own
create policy "preds_read"   on public.predictions for select using (
  user_id = auth.uid() or
  exists (select 1 from public.league_members where league_id = predictions.league_id and user_id = auth.uid())
);
create policy "preds_insert" on public.predictions for insert with check (auth.uid() = user_id);
create policy "preds_update" on public.predictions for update using (auth.uid() = user_id);

-- Scores: readable by league members
create policy "scores_read" on public.scores for select using (
  exists (
    select 1 from public.predictions pred
    join public.league_members lm on lm.league_id = pred.league_id
    where pred.id = scores.prediction_id and lm.user_id = auth.uid()
  )
);

-- Profiles: users can read all profiles in their leagues; update own
create policy "profiles_read" on public.profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);
