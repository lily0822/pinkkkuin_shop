-- 客人回覆「數量正確」後鎖定該批已列清單的訂單數量，避免後續誤觸舊
-- Carousel/直向清單上的數量按鈕再次改動。null = 尚未鎖定（可調整）。

alter table public.community_livestream_orders
  add column if not exists quantity_locked_at timestamptz;
