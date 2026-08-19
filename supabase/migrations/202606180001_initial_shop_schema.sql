create extension if not exists pgcrypto;

do $$ begin
  create type product_type as enum ('stock', 'preorder');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type product_status as enum ('active', 'sold_out', 'draft');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type order_status as enum ('new', 'paid', 'processing', 'shipped', 'cancelled');
exception
  when duplicate_object then null;
end $$;

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  slug text not null unique,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  product_type product_type not null default 'stock',
  name text not null,
  description text,
  image_url text,
  cost_price numeric(12, 2),
  base_price numeric(12, 2) not null default 0,
  stock_quantity integer not null default 0,
  preorder_quota integer,
  deadline date,
  status product_status not null default 'draft',
  source text not null default 'supabase',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_categories (
  product_id uuid not null references products(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (product_id, category_id)
);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  legacy_id text,
  sku text,
  spec text not null default '預設款',
  price numeric(12, 2) not null default 0,
  stock_quantity integer not null default 0,
  product_url text,
  status product_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, legacy_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  customer_name text not null,
  customer_phone text,
  delivery_method text,
  delivery_address text,
  payment_method text,
  status order_status not null default 'new',
  subtotal numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  notes text,
  source text not null default 'shop_frontend',
  legacy_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  product_name text not null,
  variant_spec text,
  unit_price numeric(12, 2) not null default 0,
  quantity integer not null default 1,
  subtotal numeric(12, 2) generated always as (unit_price * quantity) stored,
  product_url text,
  created_at timestamptz not null default now()
);

create index if not exists products_type_status_idx on products(product_type, status);
create index if not exists products_legacy_id_idx on products(legacy_id);
create index if not exists product_variants_product_id_idx on product_variants(product_id);
create index if not exists orders_created_at_idx on orders(created_at desc);
create index if not exists order_items_order_id_idx on order_items(order_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at
before update on categories
for each row execute function set_updated_at();

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
before update on products
for each row execute function set_updated_at();

drop trigger if exists product_variants_set_updated_at on product_variants;
create trigger product_variants_set_updated_at
before update on product_variants
for each row execute function set_updated_at();

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
before update on orders
for each row execute function set_updated_at();

alter table categories enable row level security;
alter table products enable row level security;
alter table product_categories enable row level security;
alter table product_variants enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

drop policy if exists "Public can read categories" on categories;
create policy "Public can read categories"
on categories for select
using (true);

drop policy if exists "Public can read active products" on products;
create policy "Public can read active products"
on products for select
using (status = 'active');

drop policy if exists "Public can read product category links" on product_categories;
create policy "Public can read product category links"
on product_categories for select
using (true);

drop policy if exists "Public can read active variants" on product_variants;
create policy "Public can read active variants"
on product_variants for select
using (status = 'active');

drop policy if exists "Public can create orders" on orders;
create policy "Public can create orders"
on orders for insert
with check (true);

drop policy if exists "Public can create order items" on order_items;
create policy "Public can create order items"
on order_items for insert
with check (true);
