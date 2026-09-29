-- 購買狀態簡化為兩態：移除 community_livestream_purchase_status 的
-- 'confirming' 中間值，只保留 ('not_bought', 'bought')。匯款狀態
-- (community_livestream_payment_status) 維持三態不動 — 自助匯款申報流程
-- (202609300002) 需要用到它的 'confirming' 中間值。
--
-- Postgres enum 不支援直接砍值，這裡用標準做法：建一個新 enum type →
-- 把欄位轉型過去（轉型時明確把任何殘留的 'confirming' 資料列一併轉成
-- 'not_bought'，不假設 Staging 上已經沒有這個值的資料）→ 砍掉舊 type →
-- 把新 type 改名回原本的名字。寫成可重複執行也不會出錯的版本。

do $$
begin
  if not exists (select 1 from pg_type where typname = 'community_livestream_purchase_status_v2') then
    create type community_livestream_purchase_status_v2 as enum ('not_bought', 'bought');
  end if;
end $$;

alter table public.community_livestream_orders
  alter column purchase_status drop default;

alter table public.community_livestream_orders
  alter column purchase_status type community_livestream_purchase_status_v2
  using (
    case
      when purchase_status::text = 'confirming' then 'not_bought'
      else purchase_status::text
    end
  )::community_livestream_purchase_status_v2;

alter table public.community_livestream_orders
  alter column purchase_status set default 'not_bought'::community_livestream_purchase_status_v2;

drop type if exists community_livestream_purchase_status;

alter type community_livestream_purchase_status_v2 rename to community_livestream_purchase_status;
