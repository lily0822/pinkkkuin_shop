-- 連線代購【一般商品／扭蛋 分類 v2】：每件連線商品分成「一般商品」或
-- 「扭蛋」，後台訂單可以依分類篩選。
--
-- 1) community_livestream_orders 新增 product_category 欄位，預設
--    'general'——既有訂單全部視為一般商品，不用另外跑 UPDATE 回填（加
--    欄位時帶常數 DEFAULT，PostgreSQL 本身就會讓既有資料讀到這個預設
--    值）。
alter table public.community_livestream_orders
  add column if not exists product_category text not null default 'general';

alter table public.community_livestream_orders
  drop constraint if exists community_livestream_orders_product_category_check;
alter table public.community_livestream_orders
  add constraint community_livestream_orders_product_category_check
  check (product_category in ('general', 'gacha'));

-- 2) 重寫 submit_livestream_order，以 202610280003 那一版為基礎（沿用
--    它修過的「送出後關閉下單模式」行為，不要漏掉），p_items 每一項多
--    一個選填的 category：
--    - 有帶且合法（'general'/'gacha'） → 寫入該列 product_category。
--    - 沒帶這個欄位 → 維持該列原值（COALESCE 落回舊值，新訂單原值就是
--      上面加欄位時給的預設 'general'）。
--    - 帶了但不是合法值 → 當 general 處理，不讓整筆送出失敗。
--    用 jsonb 的 `?` 既有鍵判斷運算子區分「完全沒帶這個欄位」跟「帶了
--    空字串/不合法字串」兩種情況，兩者語意不同（見上面）。
create or replace function public.submit_livestream_order(
  p_line_user_id text,
  p_session_id uuid,
  p_items jsonb, -- [{id, quantity, unit_price, category?}]
  p_remove_ids uuid[]
)
returns setof public.community_livestream_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_ok boolean;
  v_item jsonb;
  v_id uuid;
  v_quantity integer;
  v_unit_price numeric(12, 2);
  v_category_raw text;
  v_category text;
  v_display_name text;
  v_updated_ids uuid[] := '{}';
begin
  select exists(
    select 1 from public.community_livestream_sessions
    where id = p_session_id and now() >= starts_at and now() < ends_at
  ) into v_session_ok;
  if not v_session_ok then
    raise exception 'session_not_active';
  end if;

  if p_remove_ids is not null and array_length(p_remove_ids, 1) > 0 then
    delete from public.community_livestream_orders
      where id = any(p_remove_ids) and line_user_id = p_line_user_id and order_status = 'staged';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;

    -- 防呆：即使呼叫端（API route）已經驗證過範圍，這裡再擋一次，不信任
    -- 任何進到這支函式裡的輸入。超出範圍的項目直接略過，不中斷整批。
    if v_id is null or v_quantity is null or v_quantity < 1 or v_quantity > 99
       or v_unit_price is null or v_unit_price <= 0 then
      continue;
    end if;

    if v_item ? 'category' then
      v_category_raw := v_item->>'category';
      v_category := case when v_category_raw in ('general', 'gacha') then v_category_raw else 'general' end;
    else
      v_category := null; -- 沒帶這個欄位，底下用 coalesce 維持原值
    end if;

    select line_display_name into v_display_name
      from public.community_livestream_orders
      where id = v_id and line_user_id = p_line_user_id and order_status = 'staged';
    if v_display_name is null then
      continue; -- 不屬於這個客人、已經處理過（重複送出）、或已被移除
    end if;

    update public.community_livestream_orders
      set quantity = v_quantity,
          customer_unit_price = v_unit_price,
          product_category = coalesce(v_category, product_category),
          order_status = 'submitted',
          session_id = p_session_id,
          submitted_at = now(),
          product_name = coalesce(
            product_name,
            v_display_name || '-商品' || public.increment_livestream_product_number(p_line_user_id)
          )
      where id = v_id and line_user_id = p_line_user_id and order_status = 'staged';

    v_updated_ids := array_append(v_updated_ids, v_id);
  end loop;

  -- 關閉下單模式（202610280003 修正過的既有行為，這裡原樣保留）。
  update public.community_line_bot_states
    set order_mode = null, order_burst_replied = false
    where line_user_id = p_line_user_id;

  return query
    select * from public.community_livestream_orders
    where id = any(v_updated_ids)
    order by created_at asc;
end;
$$;

revoke all on function public.submit_livestream_order(text, uuid, jsonb, uuid[]) from public;
grant execute on function public.submit_livestream_order(text, uuid, jsonb, uuid[]) to service_role;
