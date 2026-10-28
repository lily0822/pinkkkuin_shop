-- 連線代購 LINE 下單改版 第三階段：新增「賣家單價」欄位，並把「買到
-- 幾個」限制在 0～訂購數量之間。
--
-- 第二階段原本把管理員覆蓋單價的寫入目標設計成直接寫回
-- customer_unit_price（跟客人自己填的共用一個欄位），但這輪匯款金額
-- 計算需要「賣家單價 ?? 客人單價」這種 fallback，代表兩種價格必須
-- 分開保存，不能再共用同一欄位——否則賣家一旦改價，客人原始輸入就
-- 永久遺失。customer_unit_price 之後只在客人送出訂單當下寫入，賣家
-- 端一律改寫這個新欄位。
alter table public.community_livestream_orders
  add column if not exists seller_unit_price numeric(12, 2);

-- 「買到幾個」不能超過訂購數量（避免「缺貨數 = 訂購數 - 買到幾個」
-- 出現負數）。用資料庫 CHECK constraint 擋，後端 PATCH 路由捕捉違反
-- constraint 的錯誤碼（23514）轉成友善訊息，不需要額外查一次目前
-- quantity 才能驗證。
alter table public.community_livestream_orders
  add constraint community_livestream_orders_purchased_quantity_cap
    check (purchased_quantity is null or purchased_quantity <= quantity);
