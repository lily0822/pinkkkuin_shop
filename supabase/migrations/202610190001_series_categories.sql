-- 預購獨立流程：IP 標籤改掛在系列身上，不是商品身上。一個系列可以
-- 對應好幾個 IP（多選）。商品類別（category）標籤維持原樣掛在商品上，
-- 只有 IP 這個類型的標籤搬家——這張新表只拿來存系列↔IP 的多對多關聯，
-- 不是取代 product_categories（商品類別標籤還是走那張既有表）。
--
-- 結構比照既有的 product_categories（product_id/category_id 的多對多
-- join table），這裡換成 series_id/category_id。UI 層只讓使用者在這裡
-- 選 type='ip' 的標籤（後台 picker 只列 IP），但資料庫層故意不加
-- categories.type='ip' 的 check constraint——那樣的條件式約束要用
-- trigger 才能做，這個專案目前所有既有的標籤關聯表都沒有這種寫法，
-- 交給應用層（product-series-sync.ts）保證不混進商品類別標籤就好。
create table if not exists series_categories (
  series_id uuid not null references product_series(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (series_id, category_id)
);

alter table series_categories enable row level security;

-- 比照 product_categories 的「Public can read product category links」
-- 慣例：前台要讀這個關聯算系列的 IP 篩選用，是公開資料。這張表是這次
-- 新建的，明確 grant 三個角色，不依賴任何預設權限。
grant select on series_categories to anon;
grant select on series_categories to authenticated;
grant select, insert, update, delete on series_categories to service_role;

drop policy if exists "Public can read series category links" on series_categories;
create policy "Public can read series category links"
on series_categories for select
using (true);
