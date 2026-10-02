-- 修正商品自動命名「{LINE顯示名稱}-商品{N}」的競態條件：原本
-- generateFallbackProductName（src/lib/line/livestream-orders.ts）是用
-- 「查詢 community_livestream_orders 目前筆數 + 1」算下一個編號——客人
-- 連續快速傳好幾張照片時，多個 handleImageMessage 呼叫可能在前一筆真正
-- 寫進資料庫之前就幾乎同時查到同一個筆數，算出同一個編號，導致兩筆不同
-- 訂單撞號（都叫「商品3」）。

-- community_line_bot_states 加一欄，每個 line_user_id 各自維護自己
-- 「下一個要用的編號」。
alter table public.community_line_bot_states
  add column if not exists next_product_number integer not null default 1;

-- 原子遞增：INSERT ... ON CONFLICT DO UPDATE ... RETURNING 是單一 SQL
-- 陳述式，Postgres 對同一列的並行寫入會自動排隊（row-level lock），
-- 不會有兩個同時呼叫讀到同一個舊值——不管同時有幾支 handleImageMessage
-- 平行呼叫這支函式，每次拿到的都是獨一無二、嚴格遞增的編號。
-- 首次呼叫（這個 line_user_id 還沒有 bot state 列）直接以
-- next_product_number=2 insert，RETURNING 算出來剛好是 1，跟原本
-- 「目前筆數+1」第一次算出 1 的行為一致。
create or replace function public.increment_livestream_product_number(p_line_user_id text)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.community_line_bot_states (line_user_id, next_product_number)
  values (p_line_user_id, 2)
  on conflict (line_user_id)
  do update set next_product_number = community_line_bot_states.next_product_number + 1
  returning next_product_number - 1;
$$;

revoke all on function public.increment_livestream_product_number(text) from public;
grant execute on function public.increment_livestream_product_number(text) to service_role;
