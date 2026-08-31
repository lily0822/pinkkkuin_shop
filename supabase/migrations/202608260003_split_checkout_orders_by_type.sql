create extension if not exists pgcrypto;

create table if not exists daily_order_counters (
  order_date date not null,
  order_type text not null check (order_type in ('stock', 'preorder')),
  current_value integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_date, order_type)
);

alter table daily_order_counters enable row level security;

drop trigger if exists daily_order_counters_set_updated_at on daily_order_counters;
create trigger daily_order_counters_set_updated_at
before update on daily_order_counters
for each row execute function set_updated_at();

revoke all on daily_order_counters from anon;
revoke all on daily_order_counters from authenticated;
grant select, insert, update, delete on daily_order_counters to service_role;

alter table orders
  add column if not exists order_type text,
  add column if not exists checkout_group_id uuid;

do $$
begin
  alter table orders
    add constraint orders_order_type_check
    check (order_type in ('stock', 'preorder'));
exception
  when duplicate_object then null;
end $$;

update orders
set order_type = coalesce((
  select oi.product_type
  from order_items oi
  where oi.order_id = orders.id
    and oi.product_type in ('stock', 'preorder')
  group by oi.product_type
  order by count(*) desc, oi.product_type
  limit 1
), 'stock')
where order_type is null;

alter table orders
  alter column order_type set not null;

create unique index if not exists orders_order_no_unique_idx on orders(order_no);
create index if not exists orders_checkout_group_id_idx on orders(checkout_group_id);
create index if not exists orders_order_type_created_at_idx on orders(order_type, created_at desc);
create index if not exists daily_order_counters_date_type_idx on daily_order_counters(order_date, order_type);

create or replace function next_storefront_order_no(p_order_type text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_type text := lower(trim(coalesce(p_order_type, '')));
  prefix text;
  next_value integer;
begin
  if normalized_type not in ('stock', 'preorder') then
    raise exception 'Unsupported order type.' using errcode = 'P0001';
  end if;

  prefix := case normalized_type
    when 'stock' then 'PKS'
    when 'preorder' then 'PKP'
  end;

  insert into daily_order_counters (order_date, order_type, current_value)
  values (current_date, normalized_type, 1)
  on conflict (order_date, order_type)
  do update
    set current_value = daily_order_counters.current_value + 1,
        updated_at = now()
  returning current_value into next_value;

  return prefix || to_char(current_date, 'YYYYMMDD') || lpad(next_value::text, 5, '0');
end;
$$;

revoke all on function next_storefront_order_no(text) from public;

create or replace function create_storefront_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  item jsonb;
  validated_item jsonb;
  validated_items jsonb := '[]'::jsonb;
  group_items jsonb;
  product_record products%rowtype;
  variant_record product_variants%rowtype;
  created_order orders%rowtype;
  created_orders jsonb := '[]'::jsonb;
  customer jsonb := coalesce(payload->'customer', '{}'::jsonb);
  recipient jsonb := coalesce(payload->'recipient', '{}'::jsonb);
  shipping jsonb := coalesce(payload->'shipping', '{}'::jsonb);
  payment jsonb := coalesce(payload->'payment', '{}'::jsonb);
  items jsonb := coalesce(payload->'items', '[]'::jsonb);
  requested_quantity integer;
  product_lookup text;
  variant_lookup text;
  unit_price numeric(12, 2);
  order_subtotal numeric(12, 2);
  order_shipping_fee numeric(12, 2) := 0;
  order_discount_amount numeric(12, 2) := 0;
  order_total numeric(12, 2);
  group_id uuid := gen_random_uuid();
  current_order_type text;
  generated_order_no text;
  has_stock boolean := false;
  has_preorder boolean := false;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception '購物車是空的，請先選擇商品。' using errcode = 'P0001';
  end if;

  if nullif(trim(customer->>'name'), '') is null then
    raise exception '請填寫顧客姓名。' using errcode = 'P0001';
  end if;

  if nullif(trim(customer->>'phone'), '') is null then
    raise exception '請填寫顧客手機。' using errcode = 'P0001';
  end if;

  if nullif(trim(customer->>'email'), '') is null then
    raise exception '請填寫 Email。' using errcode = 'P0001';
  end if;

  if nullif(trim(recipient->>'name'), '') is null then
    raise exception '請填寫收件人姓名。' using errcode = 'P0001';
  end if;

  if nullif(trim(recipient->>'phone'), '') is null then
    raise exception '請填寫收件人手機。' using errcode = 'P0001';
  end if;

  if nullif(trim(shipping->>'method'), '') is null then
    raise exception '請選擇配送方式。' using errcode = 'P0001';
  end if;

  if shipping->>'method' = 'convenience_store' then
    raise exception '超商取貨尚未開放，請先選擇宅配。' using errcode = 'P0001';
  end if;

  if shipping->>'method' = 'home_delivery' and nullif(trim(coalesce(shipping->>'address', '')), '') is null then
    raise exception '請填寫配送地址。' using errcode = 'P0001';
  end if;

  for item in select value from jsonb_array_elements(items)
  loop
    product_lookup := nullif(trim(coalesce(item->>'productId', '')), '');
    variant_lookup := nullif(trim(coalesce(item->>'variantId', '')), '');
    requested_quantity := greatest(1, floor(coalesce((item->>'quantity')::numeric, 1))::integer);

    if product_lookup is null then
      raise exception '商品資料不完整，請重新整理後再試。' using errcode = 'P0001';
    end if;

    select *
      into product_record
      from products
      where id::text = product_lookup
         or legacy_id = product_lookup
      for update;

    if not found or product_record.status <> 'active' then
      raise exception '商品目前無法購買，請重新確認購物車。' using errcode = 'P0001';
    end if;

    if product_record.product_type = 'stock' then
      has_stock := true;
    elsif product_record.product_type = 'preorder' then
      has_preorder := true;
    else
      raise exception '商品類型不支援結帳。' using errcode = 'P0001';
    end if;

    if variant_lookup is not null then
      select *
        into variant_record
        from product_variants
        where (id::text = variant_lookup or legacy_id = variant_lookup)
          and product_id = product_record.id
        for update;

      if not found or variant_record.status <> 'active' then
        raise exception '商品規格目前無法購買，請重新確認購物車。' using errcode = 'P0001';
      end if;

      if requested_quantity > coalesce(variant_record.stock_quantity, 0) then
        raise exception '商品庫存不足，請重新確認購買數量。' using errcode = 'P0001';
      end if;

      unit_price := coalesce(variant_record.price, product_record.base_price, 0);
      validated_item := jsonb_build_object(
        'orderType', product_record.product_type::text,
        'productId', product_record.id,
        'variantId', variant_record.id,
        'productName', product_record.name,
        'variantSpec', variant_record.spec,
        'unitPrice', unit_price,
        'quantity', requested_quantity,
        'productUrl', variant_record.product_url,
        'productType', product_record.product_type::text
      );
    else
      if product_record.product_type = 'preorder' then
        if requested_quantity > coalesce(product_record.preorder_quota, 0) then
          raise exception '商品名額不足，請重新確認購買數量。' using errcode = 'P0001';
        end if;
      else
        if requested_quantity > coalesce(product_record.stock_quantity, 0) then
          raise exception '商品庫存不足，請重新確認購買數量。' using errcode = 'P0001';
        end if;
      end if;

      unit_price := coalesce(product_record.base_price, 0);
      validated_item := jsonb_build_object(
        'orderType', product_record.product_type::text,
        'productId', product_record.id,
        'variantId', null,
        'productName', product_record.name,
        'variantSpec', null,
        'unitPrice', unit_price,
        'quantity', requested_quantity,
        'productUrl', null,
        'productType', product_record.product_type::text
      );
    end if;

    validated_items := validated_items || jsonb_build_array(validated_item);
  end loop;

  foreach current_order_type in array array['stock', 'preorder']
  loop
    select coalesce(jsonb_agg(value), '[]'::jsonb)
      into group_items
      from jsonb_array_elements(validated_items)
      where value->>'orderType' = current_order_type;

    if jsonb_array_length(group_items) = 0 then
      continue;
    end if;

    order_subtotal := (
      select coalesce(sum(((value->>'unitPrice')::numeric) * ((value->>'quantity')::integer)), 0)
      from jsonb_array_elements(group_items)
    );
    order_total := order_subtotal + order_shipping_fee - order_discount_amount;
    generated_order_no := next_storefront_order_no(current_order_type);

    insert into orders (
      order_no,
      order_type,
      checkout_group_id,
      customer_name,
      customer_phone,
      customer_email,
      recipient_name,
      recipient_phone,
      delivery_method,
      delivery_address,
      shipping_status,
      shipping_fee,
      convenience_store_type,
      convenience_store_id,
      convenience_store_name,
      convenience_store_address,
      payment_method,
      payment_status,
      payment_transaction_id,
      status,
      subtotal,
      discount_amount,
      total,
      notes,
      source,
      legacy_payload
    ) values (
      generated_order_no,
      current_order_type,
      group_id,
      trim(customer->>'name'),
      trim(customer->>'phone'),
      trim(customer->>'email'),
      trim(recipient->>'name'),
      trim(recipient->>'phone'),
      trim(shipping->>'method'),
      nullif(trim(coalesce(shipping->>'address', '')), ''),
      'pending',
      order_shipping_fee,
      nullif(trim(coalesce(shipping->>'convenienceStoreType', '')), ''),
      nullif(trim(coalesce(shipping->>'convenienceStoreId', '')), ''),
      nullif(trim(coalesce(shipping->>'convenienceStoreName', '')), ''),
      nullif(trim(coalesce(shipping->>'convenienceStoreAddress', '')), ''),
      coalesce(nullif(trim(payment->>'method'), ''), 'pending'),
      'pending',
      nullif(trim(coalesce(payment->>'transactionId', '')), ''),
      'pending',
      order_subtotal,
      order_discount_amount,
      order_total,
      nullif(trim(coalesce(payload->>'note', '')), ''),
      'shop_frontend',
      jsonb_set(payload, '{items}', group_items, true)
    )
    returning * into created_order;

    for item in select value from jsonb_array_elements(group_items)
    loop
      if item->>'variantId' is not null then
        update product_variants
           set stock_quantity = stock_quantity - ((item->>'quantity')::integer),
               status = case when stock_quantity - ((item->>'quantity')::integer) <= 0 then 'sold_out'::product_status else status end
         where id = (item->>'variantId')::uuid;

        insert into order_items (
          order_id,
          product_id,
          variant_id,
          product_name,
          variant_spec,
          unit_price,
          quantity,
          product_url,
          product_type
        ) values (
          created_order.id,
          (item->>'productId')::uuid,
          (item->>'variantId')::uuid,
          item->>'productName',
          nullif(item->>'variantSpec', ''),
          (item->>'unitPrice')::numeric,
          (item->>'quantity')::integer,
          nullif(item->>'productUrl', ''),
          item->>'productType'
        );
      else
        if current_order_type = 'preorder' then
          update products
             set preorder_quota = preorder_quota - ((item->>'quantity')::integer),
                 status = case when preorder_quota - ((item->>'quantity')::integer) <= 0 then 'sold_out'::product_status else status end
           where id = (item->>'productId')::uuid;
        else
          update products
             set stock_quantity = stock_quantity - ((item->>'quantity')::integer),
                 status = case when stock_quantity - ((item->>'quantity')::integer) <= 0 then 'sold_out'::product_status else status end
           where id = (item->>'productId')::uuid;
        end if;

        insert into order_items (
          order_id,
          product_id,
          product_name,
          unit_price,
          quantity,
          product_type
        ) values (
          created_order.id,
          (item->>'productId')::uuid,
          item->>'productName',
          (item->>'unitPrice')::numeric,
          (item->>'quantity')::integer,
          item->>'productType'
        );
      end if;
    end loop;

    created_orders := created_orders || jsonb_build_array(jsonb_build_object(
      'id', created_order.id,
      'orderNo', created_order.order_no,
      'orderType', created_order.order_type,
      'checkoutGroupId', created_order.checkout_group_id,
      'subtotal', created_order.subtotal,
      'shippingFee', created_order.shipping_fee,
      'discountAmount', created_order.discount_amount,
      'total', created_order.total,
      'paymentStatus', created_order.payment_status,
      'shippingStatus', created_order.shipping_status,
      'status', created_order.status
    ));
  end loop;

  return jsonb_build_object(
    'checkoutGroupId', group_id,
    'orders', created_orders
  );
end;
$$;

revoke all on function create_storefront_order(jsonb) from public;
grant execute on function create_storefront_order(jsonb) to anon;
grant execute on function create_storefront_order(jsonb) to authenticated;
