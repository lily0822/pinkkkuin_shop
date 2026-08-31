create extension if not exists pgcrypto;

alter table orders
  add column if not exists customer_email text,
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists shipping_status text not null default 'pending',
  add column if not exists shipping_fee numeric(12, 2) not null default 0,
  add column if not exists convenience_store_type text,
  add column if not exists convenience_store_id text,
  add column if not exists convenience_store_name text,
  add column if not exists convenience_store_address text,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_transaction_id text,
  add column if not exists discount_amount numeric(12, 2) not null default 0;

alter table order_items
  add column if not exists product_type text;

do $$
begin
  alter type order_status add value if not exists 'pending';
exception
  when duplicate_object then null;
end $$;

drop policy if exists "Public can create orders" on orders;
drop policy if exists "Public can create order items" on order_items;

create or replace function create_storefront_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  item jsonb;
  product_record products%rowtype;
  variant_record product_variants%rowtype;
  created_order orders%rowtype;
  generated_order_no text;
  customer jsonb := coalesce(payload->'customer', '{}'::jsonb);
  recipient jsonb := coalesce(payload->'recipient', '{}'::jsonb);
  shipping jsonb := coalesce(payload->'shipping', '{}'::jsonb);
  payment jsonb := coalesce(payload->'payment', '{}'::jsonb);
  items jsonb := coalesce(payload->'items', '[]'::jsonb);
  requested_quantity integer;
  product_lookup text;
  variant_lookup text;
  unit_price numeric(12, 2);
  line_subtotal numeric(12, 2);
  order_subtotal numeric(12, 2) := 0;
  order_shipping_fee numeric(12, 2) := 0;
  order_discount_amount numeric(12, 2) := 0;
  order_total numeric(12, 2) := 0;
  attempt_count integer := 0;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception '購物車是空的，請先選擇商品。' using errcode = 'P0001';
  end if;

  if nullif(trim(customer->>'name'), '') is null then
    raise exception '請填寫姓名。' using errcode = 'P0001';
  end if;

  if nullif(trim(customer->>'phone'), '') is null then
    raise exception '請填寫手機。' using errcode = 'P0001';
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
    raise exception '門市選擇功能尚未啟用，暫時不能送出 7-11 訂單。' using errcode = 'P0001';
  end if;

  if shipping->>'method' = 'home_delivery' and nullif(trim(coalesce(shipping->>'address', '')), '') is null then
    raise exception '請填寫宅配地址。' using errcode = 'P0001';
  end if;

  for item in select value from jsonb_array_elements(items)
  loop
    product_lookup := nullif(trim(coalesce(item->>'productId', '')), '');
    variant_lookup := nullif(trim(coalesce(item->>'variantId', '')), '');
    requested_quantity := greatest(1, floor(coalesce((item->>'quantity')::numeric, 1))::integer);

    if product_lookup is null then
      raise exception '商品資料不完整，請重新確認購物車。' using errcode = 'P0001';
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
        raise exception '商品庫存不足，請重新確認購物車。' using errcode = 'P0001';
      end if;

      unit_price := coalesce(variant_record.price, product_record.base_price, 0);
    else
      if product_record.product_type = 'preorder' then
        if requested_quantity > coalesce(product_record.preorder_quota, 0) then
          raise exception '商品庫存不足，請重新確認購物車。' using errcode = 'P0001';
        end if;
      else
        if requested_quantity > coalesce(product_record.stock_quantity, 0) then
          raise exception '商品庫存不足，請重新確認購物車。' using errcode = 'P0001';
        end if;
      end if;

      unit_price := coalesce(product_record.base_price, 0);
    end if;

    order_subtotal := order_subtotal + (unit_price * requested_quantity);
  end loop;

  order_total := order_subtotal + order_shipping_fee - order_discount_amount;

  loop
    generated_order_no := 'PK' || to_char(now(), 'YYYYMMDD') || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));
    exit when not exists (select 1 from orders where order_no = generated_order_no);
    attempt_count := attempt_count + 1;
    if attempt_count > 10 then
      raise exception '訂單編號產生失敗，請稍後再試。' using errcode = 'P0001';
    end if;
  end loop;

  insert into orders (
    order_no,
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
    payload
  )
  returning * into created_order;

  for item in select value from jsonb_array_elements(items)
  loop
    product_lookup := nullif(trim(coalesce(item->>'productId', '')), '');
    variant_lookup := nullif(trim(coalesce(item->>'variantId', '')), '');
    requested_quantity := greatest(1, floor(coalesce((item->>'quantity')::numeric, 1))::integer);

    select *
      into product_record
      from products
      where id::text = product_lookup
         or legacy_id = product_lookup
      for update;

    if variant_lookup is not null then
      select *
        into variant_record
        from product_variants
        where (id::text = variant_lookup or legacy_id = variant_lookup)
          and product_id = product_record.id
        for update;

      unit_price := coalesce(variant_record.price, product_record.base_price, 0);
      line_subtotal := unit_price * requested_quantity;

      update product_variants
         set stock_quantity = stock_quantity - requested_quantity,
             status = case when stock_quantity - requested_quantity <= 0 then 'sold_out'::product_status else status end
       where id = variant_record.id;

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
        product_record.id,
        variant_record.id,
        product_record.name,
        variant_record.spec,
        unit_price,
        requested_quantity,
        variant_record.product_url,
        product_record.product_type::text
      );
    else
      unit_price := coalesce(product_record.base_price, 0);
      line_subtotal := unit_price * requested_quantity;

      if product_record.product_type = 'preorder' then
        update products
           set preorder_quota = preorder_quota - requested_quantity,
               status = case when preorder_quota - requested_quantity <= 0 then 'sold_out'::product_status else status end
         where id = product_record.id;
      else
        update products
           set stock_quantity = stock_quantity - requested_quantity,
               status = case when stock_quantity - requested_quantity <= 0 then 'sold_out'::product_status else status end
         where id = product_record.id;
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
        product_record.id,
        product_record.name,
        unit_price,
        requested_quantity,
        product_record.product_type::text
      );
    end if;
  end loop;

  return jsonb_build_object(
    'id', created_order.id,
    'orderNo', created_order.order_no,
    'subtotal', created_order.subtotal,
    'shippingFee', created_order.shipping_fee,
    'discountAmount', created_order.discount_amount,
    'total', created_order.total,
    'paymentStatus', created_order.payment_status,
    'shippingStatus', created_order.shipping_status,
    'status', created_order.status
  );
end;
$$;

revoke all on function create_storefront_order(jsonb) from public;
grant execute on function create_storefront_order(jsonb) to anon;
grant execute on function create_storefront_order(jsonb) to authenticated;
