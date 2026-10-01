-- 匯款回報格式調整為「銀行／金額／末五碼」固定三項，客人自行計算總
-- 金額並依格式回報——新增 bank_name 記錄客人回報的銀行名稱（純文字，
-- 供管理員核對用，不做銀行代碼對照）。amount 欄位已在
-- 202610020001 改為可為 null，這次有值（客人自報金額）直接寫入即可，
-- 不需要再動那個欄位。
alter table public.community_livestream_remittances
  add column if not exists bank_name text;
