-- 商品編輯表單重排版：成本價/特價/原價從商品層級搬到規格層級。
-- products 表上一輪新增的 original_price、原本就有的 cost_price/base_price/
-- stock_quantity 這輪刻意不刪除，繼續當成「依規格算出來的代表值」寫入
-- （見 src/lib/backend/product-sync.ts），降低還有地方在讀商品層級欄位時
-- 出錯的風險；真正的編輯/顯示邏輯之後都走 product_variants。
alter table product_variants
  add column if not exists cost_price numeric(12, 2) not null default 0;
alter table product_variants
  add column if not exists original_price numeric(12, 2);

-- 回填既有資料：舊商品目前成本價/原價都存在 products 層級，套用上面兩個新欄位
-- 後，既有的 product_variants 列會是預設值（cost_price=0、original_price=
-- NULL），即使商品本來就填了成本價/原價。只在規格目前還是預設值時才回填，
-- 不覆蓋任何已經手動填過的值（這個 migration 理論上只會在欄位剛新增、還沒有
-- 人填過規格層級資料的那一刻跑一次，條件主要是防呆，不是預期會真的擋到什麼）。
update product_variants v
set cost_price = p.cost_price
from products p
where v.product_id = p.id
  and v.cost_price = 0
  and p.cost_price is not null
  and p.cost_price <> 0;

update product_variants v
set original_price = p.original_price
from products p
where v.product_id = p.id
  and v.original_price is null
  and p.original_price is not null;
