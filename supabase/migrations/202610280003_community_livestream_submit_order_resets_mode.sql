-- 連線代購 LINE 下單改版：修正「送出訂單」沒有關閉下單模式的既有 bug。
-- 客人在 /live/confirm 按「送出訂單」成功後，community_line_bot_states.
-- order_mode 原本一直沒被清掉——導致客人之後不小心多傳的照片還是被當成
-- 新一輪下單暫存（handleImageMessage 只看 order_mode==='ordering'），
-- 機器人還會回「收到囉」，但這些照片其實已經跟這次已經送出的訂單無關。
--
-- 選擇直接改 submit_livestream_order 這支 RPC（而不是在呼叫端 API route
-- 另外補一次 UPDATE），理由：這支 RPC 本身已經是「送出訂單」這個操作
-- 唯一、原子的交易邊界——訂單狀態轉換（staged→submitted）跟「關閉下單
-- 模式」在語意上是同一個動作的兩個副作用，包在同一個交易裡可以保證
-- 兩者要嘛一起成功、要嘛一起不生效（例如場次已結束、整個函式
-- raise exception 'session_not_active' 時，order_mode 自然也不會被動
-- 到），不需要呼叫端另外處理失敗時的回滾。
--
-- 這一行不限定「至少有一筆真的被處理」才清——只要呼叫到這支函式、
-- 場次驗證通過（沒有在最前面就 raise exception），就視為「客人送出
-- 訂單這個動作本身成功」，清掉 order_mode；即使這次剛好 p_items 全部
-- 都不符合條件（理論上不會發生，前端 canSubmit 一定會擋空清單），也
-- 不影響這個判斷——客人確實按下了「送出訂單」且請求有效送達。
-- order_burst_replied 一併重置成 false，跟「我要下單」重新觸發時的初始
-- 狀態一致（這個欄位的語意本來就只在 order_mode==='ordering' 時有意義，
-- order_mode 清成 null 之後它的值其實不再被讀取，重置純粹是保持狀態
-- 乾淨、避免之後萬一新增邏輯誤讀到舊值）。

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

  -- 關閉下單模式（本次修正新增）——送出訂單這個動作本身成功（場次驗證
  -- 已經通過），之後再傳的照片一律照「沒按我要下單就傳照片」處理，客人
  -- 要再下單必須重新輸入「我要下單」。還沒出現在這次 p_items/p_remove_ids
  -- 裡的其他 staged 照片（客人在「傳好了」之後、送出訂單之前又多傳的）
  -- 不受影響，繼續保持 staged，客人再按一次「傳好了」仍可用新的連結進
  -- 確認頁處理。
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
