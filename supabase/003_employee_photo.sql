-- Update 003 — ID photo (small JPEG, ~25 KB, stored with the employee)
alter table public.employees add column if not exists photo text;
alter table public.employees add column if not exists has_photo boolean generated always as (photo is not null) stored;
