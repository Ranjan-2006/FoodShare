-- FoodShare schema. Run this entire script in the Supabase SQL Editor.
-- The browser application must only use the project's publishable/anon key.

create extension if not exists pgcrypto;

create type public.account_role as enum ('donor', 'ngo', 'admin');
create type public.donation_status as enum ('available', 'claimed', 'picked_up', 'completed', 'expired');
create type public.claim_status as enum ('pending', 'approved', 'picked_up', 'completed', 'cancelled');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null,
  phone text check (phone is null or char_length(phone) <= 32),
  role public.account_role not null default 'donor',
  organization_name text check (organization_name is null or char_length(organization_name) <= 160),
  address text check (address is null or char_length(address) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.food_donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.users (id) on delete cascade,
  food_name text not null check (char_length(food_name) between 1 and 120),
  category text not null check (category in ('Cooked Food', 'Raw Food', 'Bakery', 'Fruits', 'Vegetables', 'Packaged Food')),
  quantity numeric(12, 2) not null check (quantity > 0),
  unit text not null check (unit in ('kg', 'packets', 'meals')),
  preparation_time timestamptz not null,
  expiry_time timestamptz not null,
  pickup_address text not null check (char_length(pickup_address) between 1 and 350),
  instructions text check (instructions is null or char_length(instructions) <= 1500),
  image_url text,
  status public.donation_status not null default 'available',
  created_at timestamptz not null default now(),
  constraint food_donations_valid_times check (expiry_time > preparation_time)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.food_donations (id) on delete cascade,
  ngo_id uuid not null references public.users (id) on delete cascade,
  claim_status public.claim_status not null default 'approved',
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index claims_one_live_claim_per_food
  on public.claims (food_id)
  where claim_status <> 'cancelled';
create index food_donations_status_expiry_idx on public.food_donations (status, expiry_time);
create index food_donations_donor_created_idx on public.food_donations (donor_id, created_at desc);
create index food_donations_category_idx on public.food_donations (category);
create index claims_ngo_claimed_idx on public.claims (ngo_id, claimed_at desc);
create index claims_food_idx on public.claims (food_id);
create index users_role_created_idx on public.users (role, created_at desc);

create or replace function public.is_foodshare_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and u.role = 'admin'::public.account_role
      and u.is_active
  );
$$;

create or replace function public.is_active_foodshare_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and u.is_active
  );
$$;

create or replace function public.create_foodshare_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'role', 'donor');
begin
  -- Public signup may create a donor or NGO, never an administrator.
  insert into public.users (id, full_name, email, phone, role, organization_name, address)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'FoodShare member'),
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    case when requested_role = 'ngo' then 'ngo'::public.account_role else 'donor'::public.account_role end,
    nullif(btrim(new.raw_user_meta_data ->> 'organization_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'address'), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created_foodshare_profile
  after insert on auth.users
  for each row execute function public.create_foodshare_profile();

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

create trigger protect_foodshare_user_role
  before update of role on public.users
  for each row execute function public.protect_user_role();

create or replace function public.set_claim_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger claims_set_updated_at
  before update on public.claims
  for each row execute function public.set_claim_updated_at();

alter table public.users enable row level security;
alter table public.food_donations enable row level security;
alter table public.claims enable row level security;

create policy "Users read own profile or admin reads all"
  on public.users for select to authenticated
  using (id = (select auth.uid()) or (select public.is_foodshare_admin()));
create policy "Active users update own non-role profile"
  on public.users for update to authenticated
  using (id = (select auth.uid()) and is_active)
  with check (id = (select auth.uid()) and is_active);
create policy "Admins manage user profiles"
  on public.users for all to authenticated
  using ((select public.is_foodshare_admin()))
  with check ((select public.is_foodshare_admin()));

create policy "Users read available food, own food, or admin reads all"
  on public.food_donations for select to authenticated
  using (
    (select public.is_foodshare_admin())
    or (
      (select public.is_active_foodshare_user())
      and (
        donor_id = (select auth.uid())
        or (
          status = 'available'::public.donation_status
          and exists (
            select 1 from public.users u
            where u.id = (select auth.uid())
              and u.role = 'ngo'::public.account_role
          )
        )
      )
    )
  );
create policy "Active donors create their own food donations"
  on public.food_donations for insert to authenticated
  with check (
    donor_id = (select auth.uid())
    and status = 'available'::public.donation_status
    and exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'donor'::public.account_role
        and u.is_active
    )
  );
create policy "Donors edit their own available food; admins manage all"
  on public.food_donations for update to authenticated
  using (
    (select public.is_foodshare_admin())
    or (
      donor_id = (select auth.uid())
      and status = 'available'::public.donation_status
      and exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role = 'donor'::public.account_role
          and u.is_active
      )
    )
  )
  with check (
    (select public.is_foodshare_admin())
    or (
      donor_id = (select auth.uid())
      and status = 'available'::public.donation_status
      and exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role = 'donor'::public.account_role
          and u.is_active
      )
    )
  );
create policy "Donors delete their own available food; admins manage all"
  on public.food_donations for delete to authenticated
  using (
    (select public.is_foodshare_admin())
    or (
      donor_id = (select auth.uid())
      and status = 'available'::public.donation_status
      and exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role = 'donor'::public.account_role
          and u.is_active
      )
    )
  );

create policy "Members read claims for their NGO or donated food; admins read all"
  on public.claims for select to authenticated
  using (
    (select public.is_foodshare_admin())
    or (
      (select public.is_active_foodshare_user())
      and (
        ngo_id = (select auth.uid())
        or exists (
          select 1 from public.food_donations d
          where d.id = claims.food_id and d.donor_id = (select auth.uid())
        )
      )
    )
  );
create policy "Admins manage claims"
  on public.claims for all to authenticated
  using ((select public.is_foodshare_admin()))
  with check ((select public.is_foodshare_admin()));

grant usage on schema public to authenticated;
grant select, update on public.users to authenticated;
grant select, insert, update, delete on public.food_donations to authenticated;
grant select on public.claims to authenticated;
revoke all on public.users, public.food_donations, public.claims from anon;

create or replace function public.browse_available_donations(
  search_term text default null,
  category_filter text default null,
  location_term text default null,
  sort_order text default 'newest'
)
returns table (
  id uuid,
  food_name text,
  category text,
  quantity numeric,
  unit text,
  preparation_time timestamptz,
  expiry_time timestamptz,
  pickup_address text,
  instructions text,
  image_url text,
  status public.donation_status,
  created_at timestamptz,
  donor_name text,
  organization_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.role = 'ngo'::public.account_role
      and u.is_active
  ) and not public.is_foodshare_admin() then
    raise exception 'An active NGO account is required to browse food donations';
  end if;
  return query
    select d.id, d.food_name, d.category, d.quantity, d.unit, d.preparation_time,
           d.expiry_time, d.pickup_address, d.instructions, d.image_url, d.status,
           d.created_at, u.full_name, u.organization_name
    from public.food_donations d
    join public.users u on u.id = d.donor_id
    where d.status = 'available'::public.donation_status
      and d.expiry_time > now()
      and u.is_active
      and (category_filter is null or d.category = category_filter)
      and (
        search_term is null
        or d.food_name ilike '%' || search_term || '%'
        or d.category ilike '%' || search_term || '%'
        or coalesce(u.organization_name, u.full_name) ilike '%' || search_term || '%'
      )
      and (location_term is null or d.pickup_address ilike '%' || location_term || '%')
    order by
      case when sort_order = 'expiry' then d.expiry_time end asc nulls last,
      case when sort_order <> 'expiry' then d.created_at end desc nulls last;
end;
$$;

create or replace function public.claim_food(donation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_claim_id uuid;
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.role = 'ngo'::public.account_role
      and u.is_active
  ) then
    raise exception 'An active NGO account is required to claim a donation';
  end if;

  update public.food_donations d
    set status = 'claimed'::public.donation_status
    where d.id = donation_id
      and d.status = 'available'::public.donation_status
      and d.expiry_time > now()
      and d.donor_id <> (select auth.uid());
  if not found then
    raise exception 'This food donation is no longer available';
  end if;

  insert into public.claims (food_id, ngo_id, claim_status)
    values (donation_id, (select auth.uid()), 'approved'::public.claim_status)
    returning id into new_claim_id;
  return new_claim_id;
end;
$$;

create or replace function public.ngo_claim_overview()
returns table (
  claim_id uuid,
  food_id uuid,
  claim_status public.claim_status,
  claimed_at timestamptz,
  food_name text,
  category text,
  quantity numeric,
  unit text,
  pickup_address text,
  donor_name text,
  donor_phone text,
  expiry_time timestamptz,
  preparation_time timestamptz,
  instructions text,
  image_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.role = 'ngo'::public.account_role
      and u.is_active
  ) and not public.is_foodshare_admin() then
    raise exception 'An active NGO account is required to view claim details';
  end if;
  return query
    select c.id, d.id, c.claim_status, c.claimed_at, d.food_name, d.category,
           d.quantity, d.unit, d.pickup_address, u.full_name, u.phone,
           d.expiry_time, d.preparation_time, d.instructions, d.image_url
    from public.claims c
    join public.food_donations d on d.id = c.food_id
    join public.users u on u.id = d.donor_id
    where c.ngo_id = (select auth.uid())
    order by c.claimed_at desc;
end;
$$;

create or replace function public.donor_claim_overview(donation_ids uuid[])
returns table (food_id uuid, ngo_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.role = 'donor'::public.account_role
      and u.is_active
  ) and not public.is_foodshare_admin() then
    raise exception 'An active donor account is required to view this claim information';
  end if;
  return query
    select d.id, coalesce(nullif(u.organization_name, ''), u.full_name)
    from public.food_donations d
    join public.claims c on c.food_id = d.id and c.claim_status <> 'cancelled'
    join public.users u on u.id = c.ngo_id
    where d.donor_id = (select auth.uid())
      and d.id = any(donation_ids);
end;
$$;

create or replace function public.update_claim_status(claim_id uuid, new_status public.claim_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_claim public.claims%rowtype;
  food_expiry timestamptz;
begin
  if not public.is_foodshare_admin() and not exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.role = 'ngo'::public.account_role
      and u.is_active
  ) then
    raise exception 'An active NGO account or administrator is required';
  end if;

  select c.* into current_claim
    from public.claims c
    where c.id = claim_id
      and (public.is_foodshare_admin() or c.ngo_id = (select auth.uid()))
    for update;
  if not found then
    raise exception 'Claim not found or access denied';
  end if;

  if not (
    (current_claim.claim_status = 'approved' and new_status in ('picked_up', 'cancelled'))
    or (current_claim.claim_status = 'picked_up' and new_status = 'completed')
  ) then
    raise exception 'This claim cannot move from % to %', current_claim.claim_status, new_status;
  end if;

  update public.claims set claim_status = new_status where id = current_claim.id;
  if new_status = 'picked_up' then
    update public.food_donations set status = 'picked_up' where id = current_claim.food_id;
  elsif new_status = 'completed' then
    update public.food_donations set status = 'completed' where id = current_claim.food_id;
  elsif new_status = 'cancelled' then
    select expiry_time into food_expiry from public.food_donations where id = current_claim.food_id;
    update public.food_donations
      set status = case when food_expiry > now() then 'available'::public.donation_status else 'expired'::public.donation_status end
      where id = current_claim.food_id;
  end if;
end;
$$;

create or replace function public.expire_food_donations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.is_active
  ) then
    raise exception 'An active FoodShare account is required';
  end if;
  update public.food_donations
    set status = 'expired'::public.donation_status
    where status = 'available'::public.donation_status
      and expiry_time <= now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.public_platform_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'food_donated', (
      select count(*) from public.food_donations d
      where d.status <> 'expired'::public.donation_status
        and (d.status <> 'available'::public.donation_status or d.expiry_time > now())
    ),
    'meals_redistributed', coalesce((
      select sum(d.quantity) from public.food_donations d
      where d.status = 'completed'::public.donation_status
        and d.unit = 'meals'
    ), 0),
    'active_ngos', (
      select count(*) from public.users u
      where u.role = 'ngo'::public.account_role and u.is_active
    ),
    'successful_donations', (
      select count(*) from public.food_donations d
      where d.status = 'completed'::public.donation_status
    )
  );
$$;

revoke all on function public.is_foodshare_admin() from public, anon;
revoke all on function public.is_active_foodshare_user() from public, anon;
revoke all on function public.create_foodshare_profile() from public, anon, authenticated;
revoke all on function public.protect_user_role() from public, anon, authenticated;
revoke all on function public.set_claim_updated_at() from public, anon, authenticated;
revoke all on function public.browse_available_donations(text, text, text, text) from public, anon;
revoke all on function public.claim_food(uuid) from public, anon;
revoke all on function public.ngo_claim_overview() from public, anon;
revoke all on function public.donor_claim_overview(uuid[]) from public, anon;
revoke all on function public.update_claim_status(uuid, public.claim_status) from public, anon;
revoke all on function public.expire_food_donations() from public, anon;
revoke all on function public.public_platform_stats() from public;
grant execute on function public.is_foodshare_admin() to authenticated;
grant execute on function public.is_active_foodshare_user() to authenticated;
grant execute on function public.browse_available_donations(text, text, text, text) to authenticated;
grant execute on function public.claim_food(uuid) to authenticated;
grant execute on function public.ngo_claim_overview() to authenticated;
grant execute on function public.donor_claim_overview(uuid[]) to authenticated;
grant execute on function public.update_claim_status(uuid, public.claim_status) to authenticated;
grant execute on function public.expire_food_donations() to authenticated;
grant execute on function public.public_platform_stats() to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-images', 'food-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Food donation images are publicly readable"
  on storage.objects for select to public
  using (bucket_id = 'food-images');
create policy "Donors upload their own food donation images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'donor'::public.account_role
        and u.is_active
    )
  );
create policy "Donors update their own food donation images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Donors delete their own food donation images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'food-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
