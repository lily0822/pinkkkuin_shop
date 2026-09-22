-- Safely delete one community order item without granting table-level DELETE.
-- Historical remittance/shipment order_ids arrays intentionally remain unchanged
-- when deleting the final item also removes its now-empty parent order.

create or replace function public.delete_community_order_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select i.order_id
  into v_order_id
  from public.community_order_items i
  where i.id = p_item_id;

  if v_order_id is null then
    return false;
  end if;

  -- Serialize item deletion for the same parent order.
  perform 1
  from public.community_orders o
  where o.id = v_order_id
  for update;

  delete from public.community_order_items
  where id = p_item_id
    and order_id = v_order_id;

  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.community_order_items i
    where i.order_id = v_order_id
  ) then
    delete from public.community_orders
    where id = v_order_id;
  end if;

  return true;
end;
$$;

revoke all on function public.delete_community_order_item(uuid) from public;
grant execute on function public.delete_community_order_item(uuid) to service_role;
