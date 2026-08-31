drop policy if exists "Public can read active variants" on product_variants;
drop policy if exists "Public can read storefront variants" on product_variants;

create policy "Public can read storefront variants"
on product_variants for select
using (
  status in ('active', 'sold_out')
  and exists (
    select 1
    from products
    where products.id = product_variants.product_id
      and products.status = 'active'
  )
);
