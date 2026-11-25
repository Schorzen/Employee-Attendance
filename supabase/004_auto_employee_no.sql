-- Update 004 — auto-generated Employee ID, e.g. BT-2026-0001
create sequence if not exists public.employee_no_seq;
grant usage on sequence public.employee_no_seq to authenticated;
alter table public.employees alter column employee_no
  set default 'BT-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.employee_no_seq')::text, 4, '0');
