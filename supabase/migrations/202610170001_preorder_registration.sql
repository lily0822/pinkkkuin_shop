-- 預購獨立流程 第一期（地基）：預購清單（跟現貨購物車完全分開的概念，
-- 伺服器端持久保存，不是 localStorage）+ 簡化版預購登記 RPC。
--
-- 鍵用 user_id（不是 line_user_id）：跟 orders/member_addresses 等其他
-- 會員資料表保持一致的鍵——這個人之後除了 LINE 也用 email/Google 登入，
-- 看到的還是同一份清單，不會因為登入方式不同而分裂成兩份。line_user_id
-- 只是「怎麼找到這個 user_id」的其中一條路（透過既有的
-- member_line_accounts），不是這張表自己的鍵。

create table if not exists preorder_list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  quantity integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists preorder_list_items_user_id_idx on preorder_list_items(user_id, created_at);

-- 同一個人對同一個商品/規格只能有一列（加入清單時數量累加，不是一直
-- 新增新列）。variant_id 可留空（沒有多規格的商品），一般 unique
-- constraint 對 NULL 不會當作相等、擋不住重複——改用運算式 unique
-- index，把 NULL 統一代換成一個固定的 nil uuid 再比較。這張表目前還
-- 沒有任何程式碼在寫（第一期只先把資料庫地基搭好），「加入清單」的
-- API（第四期）要用這個 index 做 upsert，不是這輪要處理的事，這裡先
-- 把正確的唯一性語意定好。
create unique index if not exists preorder_list_items_user_product_variant_idx
  on preorder_list_items (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table preorder_list_items enable row level security;

revoke all on preorder_list_items from anon;
grant select, insert, update, delete on preorder_list_items to authenticated;

drop policy if exists "Members can read own preorder list items" on preorder_list_items;
create policy "Members can read own preorder list items"
on preorder_list_items for select
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can create own preorder list items" on preorder_list_items;
create policy "Members can create own preorder list items"
on preorder_list_items for insert
to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can update own preorder list items" on preorder_list_items;
create policy "Members can update own preorder list items"
on preorder_list_items for update
to authenticated
using (auth.uid() is not null and user_id = auth.uid())
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can delete own preorder list items" on preorder_list_items;
create policy "Members can delete own preorder list items"
on preorder_list_items for delete
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

-- 簡化版預購登記：沿用 create_storefront_order() 的商品/規格查詢、
-- 名額檢查、扣庫存邏輯，但不要求收件地址/付款方式——這兩個 create_
-- storefront_order 本身在最前面就用 raise exception 擋，資料表欄位
-- 本身其實都允許留空（調查階段已經確認過），擋的是應用層而不是資料表，
-- 所以沒辦法直接沿用那支、需要另外這支。
--
-- 不吃任何參數：清單內容只從 preorder_list_items 用 auth.uid() 自己的
-- user_id 去查，不信任任何前端傳入的清單/數量——跟 create_storefront_
-- order「商品資料一律重新查一次當下真實狀態」的原則一致。
--
-- orders.user_id 不需要在這裡手動設——既有的
-- set_storefront_order_user_id trigger（202609040002_member_order_
-- ownership.sql）會在 insert 時自動用 auth.uid() 填，跟現有結帳流程
-- 共用同一個歸屬機制。
create or replace function create_preorder_registration()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_customer_name text;
  list_row record;
  product_record products%rowtype;
  variant_record product_variants%rowtype;
  unit_price numeric(12, 2);
  validated_item jsonb;
  validated_items jsonb := '[]'::jsonb;
  submitted_ids uuid[] := array[]::uuid[];
  order_subtotal numeric(12, 2);
  generated_order_no text;
  created_order orders%rowtype;
  item jsonb;
begin
  if v_user_id is null then
    raise exception '請先登入會員。' using errcode = 'P0001';
  end if;

  select display_name into v_customer_name from member_profiles where user_id = v_user_id;
  v_customer_name := coalesce(nullif(trim(coalesce(v_customer_name, '')), ''), '預購會員');

  for list_row in
    select id, product_id, variant_id, quantity
    from preorder_list_items
    where user_id = v_user_id
    order by created_at asc
  loop
    select * into product_record from products where id = list_row.product_id for update;
    if not found or product_record.status <> 'active' or product_record.product_type <> 'preorder' then
      raise exception '清單裡有商品目前無法登記，請重新整理清單後再試。' using errcode = 'P0001';
    end if;

    if list_row.variant_id is not null then
      select *
        into variant_record
        from product_variants
        where id = list_row.variant_id and product_id = product_record.id
        for update;

      if not found or variant_record.status <> 'active' then
        raise exception '清單裡有規格目前無法登記，請重新整理清單後再試。' using errcode = 'P0001';
      end if;

      if list_row.quantity > coalesce(variant_record.stock_quantity, 0) then
        raise exception '商品名額不足，請重新確認登記數量。' using errcode = 'P0001';
      end if;

      unit_price := coalesce(variant_record.price, product_record.base_price, 0);
      validated_item := jsonb_build_object(
        'listItemId', list_row.id,
        'productId', product_record.id,
        'variantId', variant_record.id,
        'productName', product_record.name,
        'variantSpec', variant_record.spec,
        'unitPrice', unit_price,
        'quantity', list_row.quantity,
        'productUrl', variant_record.product_url
      );
    else
      if list_row.quantity > coalesce(product_record.preorder_quota, 0) then
        raise exception '商品名額不足，請重新確認登記數量。' using errcode = 'P0001';
      end if;

      unit_price := coalesce(product_record.base_price, 0);
      validated_item := jsonb_build_object(
        'listItemId', list_row.id,
        'productId', product_record.id,
        'variantId', null,
        'productName', product_record.name,
        'variantSpec', null,
        'unitPrice', unit_price,
        'quantity', list_row.quantity,
        'productUrl', null
      );
    end if;

    validated_items := validated_items || jsonb_build_array(validated_item);
    submitted_ids := submitted_ids || list_row.id;
  end loop;

  if jsonb_array_length(validated_items) = 0 then
    raise exception '預購清單是空的，請先加入商品。' using errcode = 'P0001';
  end if;

  order_subtotal := (
    select coalesce(sum(((value->>'unitPrice')::numeric) * ((value->>'quantity')::integer)), 0)
    from jsonb_array_elements(validated_items)
  );
  generated_order_no := next_storefront_order_no('preorder');

  -- 刻意不填 customer_phone/customer_email/recipient_name/recipient_
  -- phone/delivery_method/delivery_address/payment_method 這些欄位
  -- （資料表本身允許留空）——之後由店家另外跟客人確認地址/收款，不是
  -- 這支函式的事。source 用獨立的值方便之後在後台分辨這批訂單是從
  -- LINE 預購清單簡化流程進來的，不是正常結帳。
  insert into orders (
    order_no,
    order_type,
    customer_name,
    shipping_status,
    shipping_fee,
    payment_status,
    status,
    subtotal,
    discount_amount,
    total,
    source,
    legacy_payload
  ) values (
    generated_order_no,
    'preorder',
    v_customer_name,
    'pending',
    0,
    'pending',
    'pending',
    order_subtotal,
    0,
    order_subtotal,
    'line_preorder_registration',
    jsonb_build_object('items', validated_items)
  )
  returning * into created_order;

  for item in select value from jsonb_array_elements(validated_items)
  loop
    if item->>'variantId' is not null then
      update product_variants
         set stock_quantity = stock_quantity - ((item->>'quantity')::integer),
             status = case when stock_quantity - ((item->>'quantity')::integer) <= 0 then 'sold_out'::product_status else status end
       where id = (item->>'variantId')::uuid;
    else
      update products
         set preorder_quota = preorder_quota - ((item->>'quantity')::integer),
             status = case when preorder_quota - ((item->>'quantity')::integer) <= 0 then 'sold_out'::product_status else status end
       where id = (item->>'productId')::uuid;
    end if;

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
      'preorder'
    );
  end loop;

  -- 送出＝消耗這份清單，比照購物車結帳後清空購物車的概念，只清掉這次
  -- 真的送出去的那些列（用 submitted_ids，不是整個 user_id 清空）——
  -- 理論上登記過程中不會有新項目插進來，但這樣寫更精確、不會誤刪。
  delete from preorder_list_items where id = any(submitted_ids);

  return jsonb_build_object(
    'id', created_order.id,
    'orderNo', created_order.order_no,
    'total', created_order.total
  );
end;
$$;

revoke all on function create_preorder_registration() from public;
grant execute on function create_preorder_registration() to authenticated;
