alter table orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists orders_user_id_created_at_idx
  on orders(user_id, created_at desc);

create or replace function set_storefront_order_user_id()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.user_id is null and auth.uid() is not null then
    new.user_id := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_storefront_user_id on orders;
create trigger orders_set_storefront_user_id
before insert on orders
for each row execute function set_storefront_order_user_id();

alter table orders enable row level security;
alter table order_items enable row level security;

grant select on orders to authenticated;
grant select on order_items to authenticated;

drop policy if exists "Members can read own orders" on orders;
create policy "Members can read own orders"
on orders for select
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can read own order items" on order_items;
create policy "Members can read own order items"
on order_items for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from orders
    where orders.id = order_items.order_id
      and orders.user_id = auth.uid()
  )
);

revoke all on function set_storefront_order_user_id() from public;
