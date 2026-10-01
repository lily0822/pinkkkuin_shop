-- 客人端數量/價格互動整組移除（「好了」清單、數量按鈕、價格有誤回報）
-- 後，匯款申報不再計算/快照金額——community_livestream_remittances.amount
-- 原本是 not null（觸發當下算好的金額快照），現在改成可為 null，申報時
-- 單純不帶這個欄位即可，不會因為少算金額導致寫入失敗。純放寬約束，不
-- 改型別、不影響既有資料。
alter table public.community_livestream_remittances
  alter column amount drop not null;
