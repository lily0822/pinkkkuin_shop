-- 連線代購 LINE 下單改版 第一階段：community_livestream_orders 加新流程
-- 需要的欄位。全部 add column if not exists，舊資料要相容——既有的
-- purchase_status/payment_status enum、quantity_locked_at、
-- price_disputed_at/price_dispute_suggested_price 欄位都不刪，新流程
-- 的程式碼只是不再寫入「價格異常回報」相關邏輯。

alter table public.community_livestream_orders
  add column if not exists session_id uuid references public.community_livestream_sessions(id),
  add column if not exists order_status text not null default 'submitted'
    check (order_status in ('staged', 'submitted', 'cancelled')),
  add column if not exists customer_unit_price numeric(12, 2),
  add column if not exists purchased_quantity integer,
  add column if not exists remittance_id uuid references public.community_livestream_remittances(id),
  add column if not exists submitted_at timestamptz;

-- order_status 不用額外補 backfill UPDATE——ADD COLUMN ... NOT NULL
-- DEFAULT 'submitted' 本身就會把這個預設值套用到所有既有列（這個欄位
-- 是新流程才有的概念，既有資料視為已經送出過的訂單，沒有 staged 這個
-- 中間狀態），不需要再多一個語意重複的 UPDATE。

-- backfill：既有的 purchase_status='bought' 視為「全部買到」，其餘維持
-- null（代表待採買）；'confirming' 這個舊的第三態 enum 值目前完全沒有
-- 程式碼會寫入（202609300001 migration 已經把三態收斂成兩態），這裡不用
-- 特別處理。
update public.community_livestream_orders
  set purchased_quantity = quantity
  where purchase_status = 'bought' and purchased_quantity is null;

create index if not exists community_livestream_orders_session_idx
  on public.community_livestream_orders (session_id);
create index if not exists community_livestream_orders_status_idx
  on public.community_livestream_orders (order_status);
