-- 後台新增獨立的「匯款紀錄」頁籤，需要能編輯/刪除客人回報的匯款資料。
-- community_livestream_remittances 原本是刻意設計成 append-only 的申報
-- 紀錄表 (202609300002 只給了 select/insert)，這次解除限制補上
-- update/delete grant。
--
-- 另外新增 reviewed_at (null = 尚未核對，有值 = 管理員已核對處理過)，
-- 供後台「未核對／已核對」快篩用——這跟 community_livestream_orders 的
-- purchase_status/payment_status 是完全獨立的狀態，核對匯款紀錄本身
-- 不會連動改動訂單狀態，單純是這張表自己的處理進度標記。

alter table public.community_livestream_remittances
  add column if not exists reviewed_at timestamptz;

grant update, delete on public.community_livestream_remittances to service_role;
