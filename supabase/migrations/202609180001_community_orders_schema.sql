do $$ begin
  create type community_payment_status as enum ('unpaid', 'paid', 'in_person');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type community_arrival_status as enum ('not_shipped', 'shipped_japan', 'shipped_korea', 'arrived_taiwan');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type community_order_stage as enum ('open', 'in_person');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type community_snipe_status as enum ('pending', 'won', 'lost');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.community_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text,
  row_count integer not null default 0,
  order_count integer not null default 0,
  item_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.community_orders (
  id uuid primary key default gen_random_uuid(),
  notebook_name text not null,
  nickname text not null,
  payment_status community_payment_status not null default 'unpaid',
  arrival_status community_arrival_status not null default 'not_shipped',
  order_stage community_order_stage not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notebook_name, nickname)
);

create table if not exists public.community_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.community_orders(id) on delete cascade,
  import_batch_id uuid references public.community_import_batches(id) on delete set null,
  product_name text not null,
  quantity integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  subtotal numeric(12, 2) generated always as (unit_price * quantity) stored,
  snipe_status community_snipe_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_orders_nickname_idx on public.community_orders (lower(nickname));
create index if not exists community_orders_notebook_idx on public.community_orders (lower(notebook_name));
create index if not exists community_order_items_order_id_idx on public.community_order_items (order_id);
create index if not exists community_order_items_product_name_idx on public.community_order_items (lower(product_name));
create index if not exists community_order_items_batch_id_idx on public.community_order_items (import_batch_id);

drop trigger if exists community_orders_set_updated_at on public.community_orders;
create trigger community_orders_set_updated_at
before update on public.community_orders
for each row execute function set_updated_at();

drop trigger if exists community_order_items_set_updated_at on public.community_order_items;
create trigger community_order_items_set_updated_at
before update on public.community_order_items
for each row execute function set_updated_at();

alter table public.community_import_batches enable row level security;
alter table public.community_orders enable row level security;
alter table public.community_order_items enable row level security;

revoke all on public.community_import_batches from anon;
revoke all on public.community_import_batches from authenticated;
revoke all on public.community_import_batches from service_role;
revoke all on public.community_orders from anon;
revoke all on public.community_orders from authenticated;
revoke all on public.community_orders from service_role;
revoke all on public.community_order_items from anon;
revoke all on public.community_order_items from authenticated;
revoke all on public.community_order_items from service_role;

grant select, insert on public.community_import_batches to service_role;
grant select, insert, update on public.community_orders to service_role;
grant select, insert, update on public.community_order_items to service_role;
