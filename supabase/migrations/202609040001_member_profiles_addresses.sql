create table if not exists member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_profiles_status_check check (status in ('active', 'disabled'))
);

create table if not exists member_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_name text not null,
  phone text not null,
  postal_code text not null,
  city text not null,
  district text not null,
  address_line text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_addresses_user_id_created_at_idx
  on member_addresses(user_id, created_at desc);

create unique index if not exists member_addresses_one_default_per_user_idx
  on member_addresses(user_id)
  where is_default = true;

drop trigger if exists member_profiles_set_updated_at on member_profiles;
create trigger member_profiles_set_updated_at
before update on member_profiles
for each row execute function set_updated_at();

drop trigger if exists member_addresses_set_updated_at on member_addresses;
create trigger member_addresses_set_updated_at
before update on member_addresses
for each row execute function set_updated_at();

alter table member_profiles enable row level security;
alter table member_addresses enable row level security;

revoke all on member_profiles from anon;
revoke all on member_addresses from anon;
grant select, insert, update on member_profiles to authenticated;
grant select, insert, update, delete on member_addresses to authenticated;

drop policy if exists "Members can read own profile" on member_profiles;
create policy "Members can read own profile"
on member_profiles for select
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can create own profile" on member_profiles;
create policy "Members can create own profile"
on member_profiles for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can update own profile" on member_profiles;
create policy "Members can update own profile"
on member_profiles for update
to authenticated
using (auth.uid() is not null and user_id = auth.uid())
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can read own addresses" on member_addresses;
create policy "Members can read own addresses"
on member_addresses for select
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can create own addresses" on member_addresses;
create policy "Members can create own addresses"
on member_addresses for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can update own addresses" on member_addresses;
create policy "Members can update own addresses"
on member_addresses for update
to authenticated
using (auth.uid() is not null and user_id = auth.uid())
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can delete own addresses" on member_addresses;
create policy "Members can delete own addresses"
on member_addresses for delete
to authenticated
using (auth.uid() is not null and user_id = auth.uid());
