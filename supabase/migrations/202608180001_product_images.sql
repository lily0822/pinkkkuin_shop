create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  public_id text,
  secure_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_secure_url_check check (secure_url ~ '^https://')
);

create index if not exists product_images_product_sort_idx
on product_images(product_id, sort_order, created_at);

create unique index if not exists product_images_one_primary_idx
on product_images(product_id)
where is_primary;

drop trigger if exists product_images_set_updated_at on product_images;
create trigger product_images_set_updated_at
before update on product_images
for each row execute function set_updated_at();

alter table product_images enable row level security;

drop policy if exists "Public can read product images" on product_images;
create policy "Public can read product images"
on product_images for select
using (
  exists (
    select 1
    from products
    where products.id = product_images.product_id
      and products.status = 'active'
  )
);
