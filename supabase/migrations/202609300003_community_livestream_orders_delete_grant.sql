-- 社群連線訂單卡片刪除功能（後台刪除按鈕 + LINE 自助取消訂單共用同一個
-- 硬刪除動作）需要 service_role 對 community_livestream_orders 的 delete
-- 權限。202609290001 當初只給了 select/insert/update——這張表是全新、
-- 簡單、完全獨立的設計，不比照 community_orders/community_order_items
-- 那套安全刪除 RPC，所以直接補上 delete grant，不用另外寫 RPC。

grant delete on public.community_livestream_orders to service_role;
