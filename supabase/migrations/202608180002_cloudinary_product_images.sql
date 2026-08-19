alter table if exists product_images
add column if not exists public_id text;

alter table if exists product_images
add column if not exists secure_url text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'product_images' and column_name = 'object_key'
  ) then
    execute 'update product_images set public_id = coalesce(public_id, object_key) where public_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'product_images' and column_name = 'image_url'
  ) then
    execute 'update product_images set secure_url = coalesce(secure_url, image_url) where secure_url is null';
  end if;
end $$;

alter table if exists product_images
alter column secure_url set not null;

alter table if exists product_images
drop constraint if exists product_images_image_source_check;

alter table if exists product_images
drop constraint if exists product_images_public_id_check;

alter table if exists product_images
drop constraint if exists product_images_secure_url_check;

alter table if exists product_images
add constraint product_images_secure_url_check check (secure_url ~ '^https://');
