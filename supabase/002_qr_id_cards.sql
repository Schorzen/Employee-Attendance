-- =====================================================================
--  Update 002 — QR code ID cards
--  Run ONCE in Supabase → SQL Editor (after schema.sql).
-- =====================================================================

-- Secret random code printed as a QR on each ID (not the employee number,
-- so nobody can make a fake card just by knowing someone's ID number).
alter table public.employees
  add column if not exists qr_token text unique
  default replace(gen_random_uuid()::text, '-', '');
update public.employees set qr_token = replace(gen_random_uuid()::text, '-', '') where qr_token is null;
alter table public.employees alter column qr_token set not null;

-- allow 'qr' as a punch method
alter table public.attendance drop constraint if exists attendance_method_check;
alter table public.attendance add constraint attendance_method_check
  check (method in ('face','manual','qr'));

-- Shared punch logic (internal — not callable from the website directly)
create or replace function public._punch(p_employee_id uuid, p_method text, p_score real)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_last  public.attendance%rowtype;
  v_emp   public.employees%rowtype;
  v_type  text;
  v_row   public.attendance%rowtype;
begin
  select * into v_emp from public.employees where id = p_employee_id and active;
  if not found then
    return json_build_object('status','unknown');
  end if;

  select * into v_last from public.attendance
   where employee_id = p_employee_id and work_date = v_today
   order by punched_at desc limit 1;

  if found and v_last.punched_at > now() - interval '2 minutes' then
    return json_build_object('status','duplicate','punch_type',v_last.punch_type,
      'punched_at',v_last.punched_at,'full_name',v_emp.full_name);
  end if;

  v_type := case when found and v_last.punch_type = 'in' then 'out' else 'in' end;

  insert into public.attendance (employee_id, punch_type, method, match_score)
  values (p_employee_id, v_type, p_method, p_score)
  returning * into v_row;

  return json_build_object('status','ok','punch_type',v_type,'punched_at',v_row.punched_at,
    'full_name',v_emp.full_name,'employee_no',v_emp.employee_no);
end $$;
revoke all on function public._punch(uuid, text, real) from public, anon, authenticated;

-- Face kiosk
create or replace function public.record_punch(p_employee_id uuid, p_score real default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  return public._punch(p_employee_id, 'face', p_score);
end $$;

-- ID card kiosk
create or replace function public.record_punch_qr(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  select id into v_id from public.employees where qr_token = p_token;
  if v_id is null then return json_build_object('status','unknown'); end if;
  return public._punch(v_id, 'qr', null);
end $$;

revoke all on function public.record_punch_qr(text) from public, anon;
grant execute on function public.record_punch_qr(text) to authenticated;
