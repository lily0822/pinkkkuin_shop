# 資料模型:Google Sheet ↔ Supabase ↔ 前端物件

系統有三份 schema 表述,欄位命名各不相同:

- **Google Sheet**:camelCase,定義在 `lily-backend-Code.gs` 的 `SHEET_HEADERS`。
- **Supabase**:snake_case,定義在前台 repo 的 migration。
- **後台前端 JS**:camelCase,與 Sheet 同名(Apps Script 讀 Supabase 時會轉回 camelCase)。

轉換全部在 Apps Script 內完成(`readSupabase*` 讀出時轉、`syncSupabase*` 寫入時轉),
所以後台前端**永遠只看到 camelCase**,不需要知道 Supabase 的欄位名。

## 1. Google Sheet 工作表一覽

`lily-backend-Code.gs:1-20`。所有工作表由 `getOrCreateSheet()` 自動建立,
缺欄位會自動補上表頭,所以新增欄位只要改 `SHEET_HEADERS` 即可。

| 工作表 | 欄位 |
| --- | --- |
| `Vendors` | id, name, contact, location, currency, notes |
| `Orders` | id, date, vendorId, orderNo, trackingNo, shipped, shippedDate, items |
| `Websites` | id, name, contact, location, currency, link, notes |
| `StockProducts` | id, name, costPrice, listPrice, quantity, tagIds, description, image, images, active, variantsJson, variants, createdAt, updatedAt |
| `PreorderProducts` | id, name, costPrice, listPrice, quota, deadline, tagIds, description, image, images, active, variantsJson, variants, createdAt, updatedAt |
| `ProductTags` | id, name, type, enabled, sortOrder, color, createdAt, updatedAt |
| `StallSchedules` | id, period, location, image, stallFee, days, createdAt, updatedAt |
| `ConnectionSchedules` | id, period, location, image, startDate, endDate, flightFee, hotelFee, createdAt, updatedAt |
| `ScheduleSettings` | id, type, image, createdAt, updatedAt |

**JSON 欄位**(`JSON_FIELDS`):`items` / `tagIds` / `images` / `days` / `variants`。
寫入時 `JSON.stringify`,讀出時 `JSON.parse`;解析失敗時陣列型欄位退回 `[]`。

**id 規則**:所有 id 由後台前端或 `doPost` 以 `Date.now()` 產生(毫秒時間戳,數字)。
Supabase 端保留為 `legacy_id`(text),Supabase 自己的 `id` 是 uuid。
所有跨表關聯與刪除都以 `legacy_id` 為準。

## 2. Supabase 資料表

| 資料表 | 寫入者 | 用途 |
| --- | --- | --- |
| `products` | 後台(鏡像) | 現貨 + 預購商品,以 `product_type` 區分 |
| `product_variants` | 後台(鏡像) | 商品規格/變體 |
| `product_images` | 後台(鏡像) | 商品圖(僅同步有 `public_id` 者) |
| `categories` | 後台(鏡像) | 商品標籤,以 `type` 區分 `ip` / `category` |
| `product_categories` | 後台(鏡像) | 商品 ↔ 標籤多對多 |
| `schedule_settings` | 後台(鏡像) | 通用設定 KV 表,見第 5 節 |
| `stall_schedules` | 後台(鏡像) | 擺攤時程 |
| `connection_schedules` | 後台(鏡像) | 連線時程 |
| `vendors` | 後台(鏡像) | 叫貨廠商 |
| `websites` | 後台(鏡像) | 購物網站 |
| `backend_orders` | 後台(鏡像) | 後台叫貨單 / 客戶訂單(`Orders` 工作表的鏡像) |
| `orders` / `order_items` | **前台** | 前台結帳產生的正式訂單,後台目前不讀不寫 |

注意 `orders`(前台訂單)與 `backend_orders`(後台叫貨單)是兩張完全不同的表,不要混淆。

## 3. 商品欄位對應

| 前端 / Sheet | Supabase `products` | 備註 |
| --- | --- | --- |
| `id` | `legacy_id` | text |
| (無) | `product_type` | `'stock'` / `'preorder'`,由呼叫端指定 |
| `name` | `name` | |
| `description` | `description` | |
| `image` | `image_url` | 主圖 URL,由 `applyProductImages()` 從 `images` 推導 |
| `costPrice` | `cost_price` | |
| `listPrice` | `base_price` | |
| `quantity`(現貨) | `stock_quantity` | 預購時寫 0 |
| `quota`(預購) | `preorder_quota` | 現貨時寫 null |
| `deadline`(預購) | `deadline` | 現貨時寫 null |
| `active` (boolean) | `status` | 見下方狀態換算 |
| (無) | `source` | 固定 `'apps_script_backend'` |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | |

### 狀態換算 `supabaseStatus(active, quantity)`

```
active 為 false / 'false' / 'FALSE' / '0' / '下架'  → 'draft'
quantity <= 0                                      → 'sold_out'
其餘                                                → 'active'
```

讀回時 `active: row.status === 'active'`,所以 **`sold_out` 讀回後 `active` 會變成 `false`**,
在後台看起來等同「下架」。這是已知的資訊損失。

### 變體 `product_variants`

| 前端 | Supabase | 備註 |
| --- | --- | --- |
| `id` | `legacy_id` | 沒給就用 `{productId}-{序號}` |
| `spec` | `spec` | 空值時填 `'預設款'` |
| `price` | `price` | 空值時退回商品 `listPrice` |
| `quantity` | `stock_quantity` | |
| `link` | `product_url` | |
| (無) | `sku` / `status` / `sort_order` | `status` 由 `supabaseStatus` 依變體庫存個別計算 |

商品沒有任何變體時,`getProductVariantsForSupabase()` 會**自動補一筆**
`spec='預設款'`、價格=商品定價、庫存=商品庫存的預設變體。

### 圖片 `product_images`

| 前端 | Supabase |
| --- | --- |
| `url` | `secure_url` |
| `publicId` | `public_id` |
| `isPrimary` | `is_primary` |
| `sortOrder` | `sort_order` |
| (商品 `name`) | `alt_text` |

`syncSupabaseProductImages()` 只同步 `publicId` 非空的圖片。
`normalizePrimaryProductImages()` 保證恰有一張 `isPrimary`(沒有指定就取第一張)。

## 4. 標籤 `categories`

| 前端 / Sheet | Supabase | 備註 |
| --- | --- | --- |
| `id` | `legacy_id` | |
| `name` | `name` | |
| (無) | `slug` | `slugify(name)`,保留中日文字元 |
| `type` | `type` | `'ip'` / `'category'`,非此二者時沿用既有值或預設 `'category'` |
| `enabled` | `enabled` | |
| `sortOrder` | `sort_order` | |
| `color` | `color` | hex,預設 `#ec4899` |

`syncSupabaseCategory()` 用 `legacy_id` **或** `slug` 比對既有資料;
`type` / `enabled` / `sort_order` 若 payload 沒帶就沿用資料庫既有值
(commit `220e479 Fix product tag type preservation` 的處理)。

## 5. `schedule_settings`:被當成通用 KV 表

原始語意是「時程預設圖」,現在被複用為全站設定表。
欄位只有 `type`(key)、`image`(value)、`legacy_id`,value 實際上塞的是 JSON 字串。

| `type` | `image` 實際內容 |
| --- | --- |
| `stall` / `connection` | 時程預設圖 URL |
| `product-default` | 商品預設圖 URL |
| `product-default-scale` | 縮放百分比字串(50–200) |
| `brand` | JSON:`storeName` / `storeNameEn` / `logo` / `logoPublicId` |
| `brand-logo-library` | JSON 陣列:LOGO 圖庫 |
| `brand-logo` | 目前 LOGO URL(舊格式,向下相容用) |
| `brand-logo-scale` | 縮放百分比字串 |
| `brand-watermark` | JSON:URL / publicId / 透明度 / 大小 / 位置 |
| `brand-text-image` | JSON:品牌文字圖 |
| `site-info` | JSON:IG / LINE / Email / 簡介 / favicon / OG 圖 |
| `site-announcements` | JSON 陣列:頂部公告 |
| `site-banners` | JSON 陣列:首頁 Banner |
| `homepage-sections` | JSON 陣列:首頁區塊開關與排序 |
| `site-navigation` | JSON 陣列:導覽列 |

序列化 / 反序列化函式集中在 `lily-backend.html:2992-3302`
(`parseBrandSettingsValue` / `brandSettingsPayload` / `parseSiteInfoSettings` / … )。

`syncSupabaseScheduleSetting()` 特別之處:先用 `type` 做 `PATCH`,沒有命中才 upsert
(避免同一 `type` 產生多筆)。

## 6. 訂單 `backend_orders`

| 前端 / Sheet | Supabase |
| --- | --- |
| `id` | `legacy_id` |
| `date` | `date` |
| `vendorId` | `vendor_id`(轉成 string) |
| `orderNo` | `order_no` |
| `trackingNo` | `tracking_no` |
| `shipped` | `shipped`(字串 `'已出貨'` / `'未出貨'`) |
| `shippedDate` | `shipped_date` |
| `items` | `items`(jsonb 陣列) |

`items` 陣列的第一筆是 `fetchAPI` 在送出前塞入的 **meta 列**
(`{isMeta:true, orderNo, trackingNo, shipped, shippedDate}`),用來把單頭資訊一併帶進 items。
處理見 `lily-backend.html:2296-2303`。

`vendorId === 2026061002`(`CUSTOMER_ORDER_SOURCE_ID`)的訂單被視為**客戶訂單**,
在「客戶訂單明細」顯示;其餘視為叫貨單。同理 `2026062001` / `2026062002` 分別是
現貨 / 預購商品目錄的來源 id。這是用 magic id 在同一張表上做分流的權宜作法。

## 7. 時程

| 前端 / Sheet | Supabase `stall_schedules` |
| --- | --- |
| `period` / `location` / `image` | 同名 |
| `stallFee` | `stall_fee` |
| `days` | `days`(jsonb) |

| 前端 / Sheet | Supabase `connection_schedules` |
| --- | --- |
| `period` / `location` / `image` | 同名 |
| `startDate` / `endDate` | `start_date` / `end_date`(空值寫 null) |
| `flightFee` / `hotelFee` | `flight_fee` / `hotel_fee` |

## 8. 無資料庫對應的資料

| 資料 | 保存位置 |
| --- | --- |
| 總帳表 | localStorage `pinkkkuin_general_ledger` |
| 擺攤紀錄(legacy `stalls.html`) | localStorage `marketData` |
| 集運帳表 | 無,純畫面 |

見 [module-accounting.md](module-accounting.md)。
