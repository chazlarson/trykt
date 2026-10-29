create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id),
  status text not null,
  parser text not null default 'import_v1',
  error_report jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint import_jobs_status_chk check (status in ('queued', 'running', 'finished', 'failed')),
  constraint import_jobs_parser_chk check (parser = 'import_v1')
);

create index import_jobs_user_created_idx on import_jobs (user_id, created_at desc);
