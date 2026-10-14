-- 商品圖片支援「規格專屬圖片」：variant_id 留空＝商品共用圖片（既有
-- 資料全部屬於這種，相容不用處理），有值＝這張圖只屬於那一個規格。
-- on delete set null（不是 cascade）：刪掉規格不應該連帶刪掉圖片本身，
-- 只是讓這張圖退回「商品共用圖片」。
alter table product_images
  add column if not exists variant_id uuid references product_variants(id) on delete set null;

create index if not exists product_images_variant_idx on product_images(variant_id);

-- 特價功能：原價（可留空）。前台邏輯是「有填原價且原價 > 定價」才顯示
-- 劃線價，單純加一個欄位，不需要 check constraint 卡原價一定要大於
-- base_price——例如商品已經調漲、原價欄位還沒跟著更新這種過渡狀態
-- 不該讓存檔失敗，交給前台顯示邏輯自己判斷要不要顯示劃線價即可。
alter table products
  add column if not exists original_price numeric(12, 2);
