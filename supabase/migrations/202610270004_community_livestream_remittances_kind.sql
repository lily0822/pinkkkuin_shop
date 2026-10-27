-- 連線代購 LINE 下單改版 第一階段：community_livestream_remittances 加
-- 場次/類型欄位——第三階段「匯款流程」要分「連線」「預購」兩種，
-- kind='preorder' 時 order_ids 放的是 orders.id（預購單），不是這張表
-- 自己的 community_livestream_orders.id。這次只建欄位，程式碼要到第三
-- 階段才會真的寫入 'preorder' 這個值，這一輪所有既有匯款紀錄
-- （kind 預設 'live'）行為不變。

alter table public.community_livestream_remittances
  add column if not exists session_id uuid references public.community_livestream_sessions(id),
  add column if not exists kind text not null default 'live' check (kind in ('live', 'preorder'));
