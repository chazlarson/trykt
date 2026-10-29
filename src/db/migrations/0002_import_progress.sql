alter table import_jobs
  add column progress_done integer not null default 0,
  add column progress_total integer not null default 0;

alter table import_jobs
  add constraint import_jobs_progress_chk
  check (progress_done >= 0 and progress_total >= 0 and progress_done <= progress_total);
