alter table import_jobs
  add column cancel_requested boolean not null default false;
