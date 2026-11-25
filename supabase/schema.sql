-- =====================================================================
--  Employee Attendance — Supabase schema
--  Run this ONCE in Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

-- ---------- Roles: who may use the app ----------
-- Every login (admin or kiosk) is a Supabase Auth user listed here.
create table if not exists public.app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','kiosk')),
  created_at timestamptz not null default now()
);

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;

-- ---------- Employees ----------
create table if not exists public.employees (
  id              uuid primary key default gen_random_uuid(),
  employee_no     text unique not null,
  full_name       text not null,
  department      text,
  position        text,
  -- face templates: array of 128-number descriptors (no photos are stored)
  face_descriptors jsonb not null default '[]'::jsonb,
  consent_at      timestamptz,          -- when the employee signed the biometric consent
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- Attendance ----------
create table if not exists public.attendance (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  punch_type   text not null check (punch_type in ('in','out')),
  punched_at   timestamptz not null default now(),
  work_date    date not null default (now() at time zone 'Asia/Manila')::date,
  method       text not null default 'face' check (method in ('face','manual')),
  match_score  real,                    -- face distance (lower = better match)
  note         text,
  recorded_by  uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists attendance_emp_date_idx on public.attendance (employee_id, work_date);
create index if not exists attendance_date_idx     on public.attendance (work_date);

-- ---------- Row Level Security ----------
alter table public.app_users  enable row level security;
alter table public.employees  enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "read own role" on public.app_users;
create policy "read own role" on public.app_users
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Employees: kiosk + admin can read; only admin can change
drop policy if exists "staff read employees" on public.employees;
create policy "staff read employees" on public.employees
  for select to authenticated using (public.is_staff());

drop policy if exists "admin write employees" on public.employees;
create policy "admin write employees" on public.employees
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Attendance: only admin reads/edits directly. The kiosk records through record_punch().
drop policy if exists "admin all attendance" on public.attendance;
create policy "admin all attendance" on public.attendance
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Table access for signed-in users (RLS above still decides which rows)
grant select on public.app_users to authenticated;
grant select, insert, update, delete on public.employees, public.attendance to authenticated;
revoke all on public.app_users, public.employees, public.attendance from anon;

-- ---------- Kiosk punch (server decides IN/OUT and uses server time) ----------
create or replace function public.record_punch(p_employee_id uuid, p_score real default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_last  public.attendance%rowtype;
  v_emp   public.employees%rowtype;
  v_type  text;
  v_row   public.attendance%rowtype;
  v_cooldown interval := interval '2 minutes';
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  select * into v_emp from public.employees where id = p_employee_id and active;
  if not found then
    raise exception 'Employee not found or inactive';
  end if;

  select * into v_last from public.attendance
   where employee_id = p_employee_id and work_date = v_today
   order by punched_at desc limit 1;

  -- ignore accidental double scans
  if found and v_last.punched_at > now() - v_cooldown then
    return json_build_object(
      'status','duplicate','punch_type',v_last.punch_type,
      'punched_at',v_last.punched_at,'full_name',v_emp.full_name);
  end if;

  v_type := case when found and v_last.punch_type = 'in' then 'out' else 'in' end;

  insert into public.attendance (employee_id, punch_type, method, match_score)
  values (p_employee_id, v_type, 'face', p_score)
  returning * into v_row;

  return json_build_object(
    'status','ok','punch_type',v_type,'punched_at',v_row.punched_at,
    'full_name',v_emp.full_name,'employee_no',v_emp.employee_no);
end $$;

revoke all on function public.record_punch(uuid, real) from public, anon;
grant execute on function public.record_punch(uuid, real) to authenticated;

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  AFTER running the above:
--  1. Authentication → Users → Add user → create your admin email + password
--     and a kiosk account (e.g. kiosk@yourcompany.com). Tick "Auto confirm".
--  2. Then run (change the emails):
--
--  insert into public.app_users (user_id, role)
--  select id, 'admin' from auth.users where email = 'admin@yourcompany.com';
--
--  insert into public.app_users (user_id, role)
--  select id, 'kiosk' from auth.users where email = 'kiosk@yourcompany.com';
-- =====================================================================
