create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  contact text,
  location text,
  currency text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists websites (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  contact text,
  location text,
  currency text,
  link text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists backend_orders (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  date text,
  vendor_id text,
  order_no text,
  tracking_no text,
  shipped text,
  shipped_date text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stall_schedules (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  period text,
  location text,
  image text,
  stall_fee numeric(12, 2),
  days jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connection_schedules (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  period text,
  location text,
  image text,
  start_date date,
  end_date date,
  flight_fee numeric(12, 2),
  hotel_fee numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists schedule_settings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  type text not null unique,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendors_legacy_id_idx on vendors(legacy_id);
create index if not exists websites_legacy_id_idx on websites(legacy_id);
create index if not exists backend_orders_legacy_id_idx on backend_orders(legacy_id);
create index if not exists stall_schedules_legacy_id_idx on stall_schedules(legacy_id);
create index if not exists connection_schedules_legacy_id_idx on connection_schedules(legacy_id);

drop trigger if exists vendors_set_updated_at on vendors;
create trigger vendors_set_updated_at
before update on vendors
for each row execute function set_updated_at();

drop trigger if exists websites_set_updated_at on websites;
create trigger websites_set_updated_at
before update on websites
for each row execute function set_updated_at();

drop trigger if exists backend_orders_set_updated_at on backend_orders;
create trigger backend_orders_set_updated_at
before update on backend_orders
for each row execute function set_updated_at();

drop trigger if exists stall_schedules_set_updated_at on stall_schedules;
create trigger stall_schedules_set_updated_at
before update on stall_schedules
for each row execute function set_updated_at();

drop trigger if exists connection_schedules_set_updated_at on connection_schedules;
create trigger connection_schedules_set_updated_at
before update on connection_schedules
for each row execute function set_updated_at();

drop trigger if exists schedule_settings_set_updated_at on schedule_settings;
create trigger schedule_settings_set_updated_at
before update on schedule_settings
for each row execute function set_updated_at();

alter table vendors enable row level security;
alter table websites enable row level security;
alter table backend_orders enable row level security;
alter table stall_schedules enable row level security;
alter table connection_schedules enable row level security;
alter table schedule_settings enable row level security;
