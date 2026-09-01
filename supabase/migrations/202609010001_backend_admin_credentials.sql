create table if not exists backend_admin_credentials (
  id uuid primary key default gen_random_uuid(),
  singleton_key boolean not null default true,
  password_hash text not null,
  password_version integer not null default 1 check (password_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint backend_admin_credentials_singleton_check check (singleton_key = true)
);

create unique index if not exists backend_admin_credentials_singleton_idx
  on backend_admin_credentials(singleton_key);

drop trigger if exists backend_admin_credentials_set_updated_at on backend_admin_credentials;
create trigger backend_admin_credentials_set_updated_at
before update on backend_admin_credentials
for each row execute function set_updated_at();

alter table backend_admin_credentials enable row level security;

revoke all on backend_admin_credentials from anon;
revoke all on backend_admin_credentials from authenticated;
grant select, insert, update, delete on backend_admin_credentials to service_role;
