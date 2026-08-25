# 模塊:商品管理(現貨 / 預購)

> 本文為既有模塊的回溯整理。

對應選單:商品管理 → 現貨商品管理 / 預購商品管理。
主要程式:`lily-backend.html:2802-4322`。

## 需求

- 管理兩類商品:**現貨**(有庫存數)與**預購**(有名額 `quota` 與截止日 `deadline`)。
- 一個商品可有多個**規格/變體**(spec、售價、庫存、外部連結)。
- 商品可掛多個**標籤**(IP / 類別),見 [module-product-tags.md](module-product-tags.md)。
- 商品可有多張圖,需指定主圖與排序,見 [module-media-upload.md](module-media-upload.md)。
- 需要批次新增、批次上下架、批次刪除、批次改標籤。
- 商品資料要能被前台 Next.js 讀到。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| 現貨 / 預購要不要合併成一張表? | Sheet 端分成 `StockProducts` / `PreorderProducts` 兩張表(欄位確實不同);Supabase 端合併為 `products` 並用 `product_type` 區分,以配合前台查詢。 |
| 變體存法 | Sheet 存 `variantsJson`(字串);Supabase 存正規化的 `product_variants` 表。前端一律用 `variants` 陣列。 |
| 編輯介面 | **行內編輯**(直接把表格列換成輸入框)而非彈窗,減少來回操作。變體則用可展開的子列(`toggleProductVariantRow`)。 |
| 存檔時的樂觀更新 | 先改本地狀態 + 重畫 + 寫 localStorage,再打後端;失敗時回滾到 `previousProducts` 快照。讓操作看起來即時,代價是失敗處理邏輯較長。 |
| 商品目錄同步 | 除了寫 `StockProducts` / `PreorderProducts`,**還會另外寫一筆「假訂單」到 `Orders`**。見下方「雙寫」。 |

## 定案(現況實作)

### 資料結構

```js
// 現貨
{ id, name, costPrice, listPrice, quantity, tagIds:[], description,
  image, images:[{url,publicId,isPrimary,sortOrder}], active,
  variants:[{id,spec,price,quantity,link}], createdAt, updatedAt }

// 預購:把 quantity 換成 quota,並多一個 deadline
```

`normalizeProduct()` / `normalizeProductVariants()` 負責把各種來源(localStorage、
Sheet 的 `variantsJson`、Supabase 讀回)統一成上面的形狀。

**變體 fallback**:沒有任何變體時,`normalizeProductVariants()` 會用 `product.spec`
以 `/` 拆分產生變體;`spec` 也是空的就補一筆 `'預設款'`。

**價格顯示**:`productPriceRange()` 取所有變體價格的 min~max,相同時只顯示一個價。

### 存檔流程(`saveProductRow`)

```
1. 防重入(productSaveInProgress[`edit-${type}-${id}`])
2. 快照 previousProducts,供失敗回滾
3. uploadPendingProductImages()   // 先把待上傳圖送 Cloudinary
4. 組出 updated,applyProductImages() 決定主圖
5. 第一個變體的價格/庫存強制對齊商品本體的 listPrice / quantity|quota
6. 樂觀更新:改記憶體、persistProductManagement()、重畫
7. saveProductToBackend()  → Apps Script saveStockProduct / savePreorderProduct
8. syncProductCatalog(type) → Apps Script saveOrder(目錄假訂單)
9. deleteCloudinaryImages(deletedPublicIds)  // 清掉編輯期間移除的舊圖
   失敗只 alert,不影響已完成的存檔
10. 任一步丟錯 → 回滾狀態 + cleanupUploadedProductImages() 回收剛上傳的圖
```

送到 Apps Script 的 payload 由 `productSheetPayload()` 產生:
把 `variants` 序列化成 `variantsJson` 後**刪掉 `variants` 欄位**(避免 Sheet 存兩份)。

### 雙寫:商品目錄也寫成一張「假訂單」

`syncProductCatalog(type)` 會用固定 id 往 `Orders` 寫一筆訂單:

| type | `vendorId` / `id` | `orderNo` |
| --- | --- | --- |
| 現貨 | `2026062001` | `STOCK-PRODUCT-CATALOG` |
| 預購 | `2026062002` | `PREORDER-PRODUCT-CATALOG` |

每個商品變成該訂單的一個 item,商品的完整 meta(成本、標籤、圖片、變體…)
以 JSON 塞進 item 的 `tracking` 欄位。讀回則是 `hydrateProductCatalogsFromOrders()`。

這是 `StockProducts` / `PreorderProducts` 專屬工作表出現**之前**的舊存法,現在兩套並存:

- `initProductManagement()` 先用假訂單 hydrate 一次(開頁的即時顯示)。
- `applyBackendData()` 之後若 `data.stockProducts` 非空,就整個覆蓋掉。

也就是**專屬工作表優先,假訂單是 fallback**。這條雙寫路徑是技術債,見後續待辦。

### 篩選與搜尋

`appliedProductFilters[type]` 保存已套用的條件(商品名稱、標籤多選、上下架狀態)。
標籤篩選是自製的下拉多選(`renderTagFilterMenu` / `toggleTagFilterMenu`),
非原生 `<select multiple>`。按「搜索」才套用(`applyProductSearch`),不是即時篩選。

### 批次操作

| 功能 | 函式 | 行為 |
| --- | --- | --- |
| 批次新增 | `openProductBatchModal` / `saveProductBatchRows` | 彈窗內可加多列,每列可獨立設定標籤與圖片;`ensureTagsByNames()` 會自動建立不存在的標籤 |
| 批次上下架 | `batchSetProductActive` | 逐筆 `saveProductToBackend` |
| 批次改標籤 | `batchEditProducts` | 逐筆更新 `tagIds` |
| 批次刪除 | `batchDeleteProducts` | 逐筆刪除,並一併刪 Cloudinary 圖 |

批次操作一律是**逐筆序列呼叫**(`syncProductsToBackend` 用 `for await`),
沒有批次 API,商品多時會很慢。

### 預購倒數

`getPreorderCountdown(deadline)` 依 `deadline` 計算剩餘天數並顯示狀態標記。

## 資料源與呼叫關係

```
商品管理頁
  ├─ 讀:loadData() → doGet → readSupabaseProducts('stock'|'preorder')
  │        (Supabase 失敗才 fallback 到 StockProducts / PreorderProducts 工作表)
  ├─ 寫:fetchAPI('saveStockProduct'|'savePreorderProduct') → Sheet + Supabase 鏡像
  ├─ 寫:fetchAPI('saveOrder') → 目錄假訂單(Orders / backend_orders)
  ├─ 圖:POST/DELETE {前台}/api/upload → Cloudinary
  └─ 快取:localStorage pinkkkuin_stock_products / pinkkkuin_preorder_products
```

前台 Next.js 只讀 Supabase 的 `products` / `product_variants` / `product_images` /
`product_categories`,**不讀假訂單**。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-03](risk-review.md#r-03) `S1` 存檔成功但 Supabase 鏡像失敗時,前端仍顯示「商品已保存」,前台卻不會更新。
- [ ] [R-06](risk-review.md#r-06) `S2` `applyBackendData` 的「陣列非空才覆蓋」會在商品被刪光時保留舊資料。
- [ ] [R-08](risk-review.md#r-08) `S2` 移除「商品目錄假訂單」雙寫路徑。
- [ ] [R-11](risk-review.md#r-11) `S2` 批次操作逐筆呼叫 API,需改為單次批次 action。
- [ ] [R-16](risk-review.md#r-16) `S3` Supabase 的 `sold_out` 讀回後變成 `active:false`,與「下架」無法區分。

一般待辦:

- [ ] 第一個變體的價格/庫存被強制對齊商品本體,使用者在變體列改第一個變體的價格會被覆蓋,行為需要確認是否符合預期。
