-- One-time bootstrap for an existing FoodShare database.
-- Run in the Supabase SQL Editor as a trusted project administrator.
-- Replace the email below with the verified account to promote.

create or replace function public.protect_user_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is null then
      if current_user not in ('postgres', 'supabase_admin', 'service_role') then
        raise exception 'Only a trusted database administrator can bootstrap an administrator account';
      end if;
    elsif not public.is_foodshare_admin() then
      raise exception 'Only an existing FoodShare administrator can change account roles';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  admin_email text := lower('rkumarsahoo638@gmail.com');
  matching_users integer;
  target_user_id uuid;
  updated_users integer;
begin
  select count(*), (array_agg(id))[1]
    into matching_users, target_user_id
    from auth.users
    where lower(email) = admin_email;

  if matching_users <> 1 then
    raise exception 'Expected exactly one auth account for %, found %', admin_email, matching_users;
  end if;

  update public.users
    set role = 'admin',
        is_active = true
    where id = target_user_id;

  get diagnostics updated_users = row_count;
  if updated_users <> 1 then
    raise exception 'No FoodShare profile exists for %. Confirm the registration trigger and profile before retrying.', admin_email;
  end if;
end;
$$;
