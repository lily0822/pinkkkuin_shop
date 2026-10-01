-- 客人回報「價格有誤」——OCR/視覺辨識偶爾抓錯價格，讓客人能針對某一筆
-- 訂單標記「這個價格不對」並留下他認為正確的金額，純粹是給管理員參考
-- 的標記，不會自動覆蓋 unit_price（真正要不要採用、怎麼修正，由管理員
-- 自己在後台決定）。price_disputed_at 為 null 代表沒有爭議；一旦管理員
-- 透過後台「單價可直接編輯」的欄位改動 unit_price 並存檔，應用程式層會
-- 把這兩欄一併清掉（視為已處理完畢），這裡不用資料庫層的 trigger 做。
alter table public.community_livestream_orders
  add column if not exists price_disputed_at timestamptz,
  add column if not exists price_dispute_suggested_price numeric(12, 2);

-- 延伸既有的 bot-state 表（202609290001）：客人點了某一筆訂單的「價格
-- 有誤」按鈕後，bot 在等他輸入認為正確的金額——比照
-- awaiting_quantity_for_order_id 同樣的「指向哪一筆訂單」做法。
alter table public.community_line_bot_states
  add column if not exists awaiting_price_dispute_for_order_id uuid references public.community_livestream_orders(id) on delete set null;
