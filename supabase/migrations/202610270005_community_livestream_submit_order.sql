-- 連線代購 LINE 下單改版 第一階段：「送出訂單」原子交易。客人在確認頁
-- 調完數量/單價、移除非商品照片後按「送出訂單」，這支 RPC 一次把
-- 「刪除移除的照片」「把剩下的 staged 列轉成 submitted（含配號）」都包在
-- 同一個函式呼叫裡，避免客人重複點兩次造成重複訂單或重複配號——
-- 重複呼叫時每筆列的 order_status 已經是 'submitted'，WHERE
-- order_status = 'staged' 查無資料，自然略過，不會重複處理（冪等）。
--
-- 商品名稱沿用既有「{LINE顯示名稱}-商品{N}」規則（increment_livestream_
-- product_number，202610050001 migration），但編號改成「送出訂單時」
-- 才產生，不是「收到照片時」——避免客人移除照片後編號出現空洞。這次
-- 移除了自動辨識（vision.ts/price-ocr.ts），product_name 在 staged
-- 階段永遠是 null，所以這裡一定會呼叫 increment_livestream_product_
-- number；用 coalesce 寫法只是防禦性寫法，不是真的預期會有既有值。
--
-- 場次必須是呼叫當下重新驗證（p_session_id 由呼叫端傳入目前進行中的
-- 場次 id，這裡再查一次確認「現在」真的還在這個場次的時間範圍內）——
-- 不能只信任呼叫端判斷過，場次可能在客人填單價的這段時間內結束。

create or replace function public.submit_livestream_order(
  p_line_user_id text,
  p_session_id uuid,
  p_items jsonb, -- [{id, quantity, unit_price}]
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

    select line_display_name into v_display_name
      from public.community_livestream_orders
      where id = v_id and line_user_id = p_line_user_id and order_status = 'staged';
    if v_display_name is null then
      continue; -- 不屬於這個客人、已經處理過（重複送出）、或已被移除
    end if;

    update public.community_livestream_orders
      set quantity = v_quantity,
          customer_unit_price = v_unit_price,
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

  return query
    select * from public.community_livestream_orders
    where id = any(v_updated_ids)
    order by created_at asc;
end;
$$;

revoke all on function public.submit_livestream_order(text, uuid, jsonb, uuid[]) from public;
grant execute on function public.submit_livestream_order(text, uuid, jsonb, uuid[]) to service_role;
