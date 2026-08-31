do $$
begin
  alter type order_status add value if not exists 'completed';
exception
  when duplicate_object then null;
end $$;

alter table orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz;

do $$
begin
  alter table orders
    add constraint orders_payment_status_check
    check (payment_status in ('pending', 'paid', 'failed', 'refunded'))
    not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table orders
    add constraint orders_shipping_status_check
    check (shipping_status in ('pending', 'preparing', 'shipped', 'completed', 'cancelled'))
    not valid;
exception
  when duplicate_object then null;
end $$;

create or replace function update_storefront_order_status(
  p_order_id uuid,
  p_status text default null,
  p_payment_status text default null,
  p_shipping_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_order orders%rowtype;
  next_status text := nullif(trim(coalesce(p_status, '')), '');
  next_payment_status text := nullif(trim(coalesce(p_payment_status, '')), '');
  next_shipping_status text := nullif(trim(coalesce(p_shipping_status, '')), '');
begin
  select * into target_order
  from orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0001';
  end if;

  if next_status is not null and next_status not in ('pending', 'processing', 'completed', 'cancelled') then
    raise exception 'Unsupported order status.' using errcode = 'P0001';
  end if;

  if next_payment_status is not null and next_payment_status not in ('pending', 'paid', 'failed', 'refunded') then
    raise exception 'Unsupported payment status.' using errcode = 'P0001';
  end if;

  if next_shipping_status is not null and next_shipping_status not in ('pending', 'preparing', 'shipped', 'completed', 'cancelled') then
    raise exception 'Unsupported shipping status.' using errcode = 'P0001';
  end if;

  if next_status = 'cancelled' then
    raise exception 'Use cancel_storefront_order to cancel orders.' using errcode = 'P0001';
  end if;

  if target_order.status in ('cancelled', 'completed') and next_status is not null and next_status <> target_order.status::text then
    raise exception 'Terminal order status cannot be changed.' using errcode = 'P0001';
  end if;

  if next_payment_status = 'refunded' and target_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can be marked refunded.' using errcode = 'P0001';
  end if;

  update orders
  set status = coalesce(next_status::order_status, status),
      payment_status = coalesce(next_payment_status, payment_status),
      shipping_status = coalesce(next_shipping_status, shipping_status),
      updated_at = now()
  where id = p_order_id
  returning * into target_order;

  return jsonb_build_object(
    'id', target_order.id,
    'orderNo', target_order.order_no,
    'orderType', target_order.order_type,
    'checkoutGroupId', target_order.checkout_group_id,
    'status', target_order.status,
    'paymentStatus', target_order.payment_status,
    'shippingStatus', target_order.shipping_status,
    'cancelReason', target_order.cancel_reason,
    'cancelledAt', target_order.cancelled_at,
    'updatedAt', target_order.updated_at
  );
end;
$$;

create or replace function cancel_storefront_order(
  p_order_id uuid,
  p_cancel_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_order orders%rowtype;
  item_record order_items%rowtype;
  reason text := nullif(trim(coalesce(p_cancel_reason, '')), '');
begin
  if reason is null then
    raise exception 'Cancel reason is required.' using errcode = 'P0001';
  end if;

  select * into target_order
  from orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0001';
  end if;

  if target_order.status = 'cancelled' then
    raise exception 'Order is already cancelled.' using errcode = 'P0001';
  end if;

  if target_order.status = 'completed' then
    raise exception 'Completed orders cannot be cancelled.' using errcode = 'P0001';
  end if;

  for item_record in
    select * from order_items where order_id = p_order_id order by created_at for update
  loop
    if item_record.variant_id is not null then
      update product_variants
      set stock_quantity = coalesce(stock_quantity, 0) + item_record.quantity,
          status = case
            when status = 'sold_out'::product_status then 'active'::product_status
            else status
          end,
          updated_at = now()
      where id = item_record.variant_id;
    elsif target_order.order_type = 'preorder' then
      update products
      set preorder_quota = coalesce(preorder_quota, 0) + item_record.quantity,
          status = case
            when status = 'sold_out'::product_status then 'active'::product_status
            else status
          end,
          updated_at = now()
      where id = item_record.product_id;
    else
      update products
      set stock_quantity = coalesce(stock_quantity, 0) + item_record.quantity,
          status = case
            when status = 'sold_out'::product_status then 'active'::product_status
            else status
          end,
          updated_at = now()
      where id = item_record.product_id;
    end if;
  end loop;

  update orders
  set status = 'cancelled'::order_status,
      shipping_status = 'cancelled',
      cancel_reason = reason,
      cancelled_at = now(),
      updated_at = now()
  where id = p_order_id
  returning * into target_order;

  return jsonb_build_object(
    'id', target_order.id,
    'orderNo', target_order.order_no,
    'orderType', target_order.order_type,
    'checkoutGroupId', target_order.checkout_group_id,
    'status', target_order.status,
    'paymentStatus', target_order.payment_status,
    'shippingStatus', target_order.shipping_status,
    'cancelReason', target_order.cancel_reason,
    'cancelledAt', target_order.cancelled_at,
    'updatedAt', target_order.updated_at
  );
end;
$$;

revoke all on function update_storefront_order_status(uuid, text, text, text) from public;
revoke all on function cancel_storefront_order(uuid, text) from public;
grant execute on function update_storefront_order_status(uuid, text, text, text) to service_role;
grant execute on function cancel_storefront_order(uuid, text) to service_role;
