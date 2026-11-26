-- Update 005 — "Present today" counter for the kiosk (counts only, no names)
create or replace function public.kiosk_today_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  return json_build_object(
    'total',   (select count(*) from public.employees where active),
    'present', (select count(distinct a.employee_id) from public.attendance a
                  join public.employees e on e.id = a.employee_id and e.active
                 where a.work_date = v_today));
end $$;
revoke all on function public.kiosk_today_stats() from public, anon;
grant execute on function public.kiosk_today_stats() to authenticated;
select proname from pg_proc where proname = 'kiosk_today_stats';
