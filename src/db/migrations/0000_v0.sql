create extension if not exists citext;

create table "user" (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  username citext not null unique,
  history_visibility text not null default 'private',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint user_history_visibility_chk check (history_visibility in ('private', 'followers', 'public'))
);

create table session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id text not null references "user" (id) on delete cascade
);

create index session_user_id_idx on session (user_id);

create table account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references "user" (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index account_user_id_idx on account (user_id);

create table verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index verification_identifier_idx on verification (identifier);

create table titles (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  tmdb_id integer not null,
  imdb_id text,
  name text not null,
  year integer,
  overview text,
  poster_path text,
  backdrop_path text,
  runtime_min integer,
  status text,
  fetched_at timestamptz,
  unavailable_at timestamptz,
  constraint titles_kind_chk check (kind in ('movie', 'show')),
  constraint titles_kind_tmdb_uidx unique (kind, tmdb_id)
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references titles (id),
  season_number integer not null,
  tmdb_id integer not null,
  name text not null,
  fetched_at timestamptz,
  constraint seasons_show_number_uidx unique (show_id, season_number)
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references titles (id),
  season_id uuid not null references seasons (id),
  season_number integer not null,
  episode_number integer not null,
  tmdb_id integer not null,
  name text not null,
  overview text,
  air_date date,
  runtime_min integer,
  still_path text,
  fetched_at timestamptz,
  constraint episodes_show_number_uidx unique (show_id, season_number, episode_number)
);

create index episodes_season_id_idx on episodes (season_id);

create table plays (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id),
  movie_id uuid references titles (id),
  episode_id uuid references episodes (id),
  watched_at timestamptz not null,
  source text not null,
  playback_session_id uuid,
  rewatch boolean not null default false,
  constraint plays_source_chk check (source in ('manual', 'bulk', 'playback', 'import')),
  constraint plays_one_subject_chk check (((movie_id is not null)::int + (episode_id is not null)::int) = 1)
);

create index plays_user_watched_idx on plays (user_id, watched_at desc);

create table resume_points (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id),
  movie_id uuid references titles (id),
  episode_id uuid references episodes (id),
  position numeric(4, 3) not null,
  updated_at timestamptz not null,
  constraint resume_position_chk check (position >= 0 and position <= 1),
  constraint resume_one_subject_chk check (((movie_id is not null)::int + (episode_id is not null)::int) = 1)
);

create unique index resume_user_movie_uidx on resume_points (user_id, movie_id) where movie_id is not null;
create unique index resume_user_episode_uidx on resume_points (user_id, episode_id) where episode_id is not null;

create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id),
  movie_id uuid references titles (id),
  show_id uuid references titles (id),
  position integer not null,
  added_at timestamptz not null,
  constraint watchlist_one_subject_chk check (((movie_id is not null)::int + (show_id is not null)::int) = 1)
);

create unique index watchlist_user_movie_uidx on watchlist_items (user_id, movie_id) where movie_id is not null;
create unique index watchlist_user_show_uidx on watchlist_items (user_id, show_id) where show_id is not null;

create table lists (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references "user" (id),
  name text not null,
  description text,
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  constraint lists_visibility_chk check (visibility in ('private', 'followers', 'public'))
);

create index lists_owner_idx on lists (owner_id);

create table list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists (id),
  movie_id uuid references titles (id),
  show_id uuid references titles (id),
  position integer not null,
  note text,
  added_at timestamptz not null,
  constraint list_items_one_subject_chk check (((movie_id is not null)::int + (show_id is not null)::int) = 1)
);

create unique index list_items_list_movie_uidx on list_items (list_id, movie_id) where movie_id is not null;
create unique index list_items_list_show_uidx on list_items (list_id, show_id) where show_id is not null;

create table ratings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id),
  subject_type text not null,
  subject_id uuid not null,
  score integer not null,
  updated_at timestamptz not null,
  constraint ratings_subject_chk check (subject_type in ('movie', 'show', 'season', 'episode')),
  constraint ratings_score_chk check (score between 1 and 10),
  constraint ratings_user_subject_uidx unique (user_id, subject_type, subject_id)
);

create table shelf_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id),
  movie_id uuid references titles (id),
  episode_id uuid references episodes (id),
  added_at timestamptz not null,
  constraint shelf_one_subject_chk check (((movie_id is not null)::int + (episode_id is not null)::int) = 1)
);

create unique index shelf_user_movie_uidx on shelf_items (user_id, movie_id) where movie_id is not null;
create unique index shelf_user_episode_uidx on shelf_items (user_id, episode_id) where episode_id is not null;

create table search_cache (
  query text primary key,
  fetched_at timestamptz not null,
  hits jsonb not null
);

create table rate_counters (
  bucket_key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
