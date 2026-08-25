# 模塊:後端 API(Apps Script Web App + Supabase 同步層)

> 本文為既有模塊的回溯整理。「選項與取捨」為依現況程式碼與 git 歷史推斷,若與當初決策不符請直接修正本文。

主要檔案:`lily-backend-Code.gs`(940 行,部署為 Google Apps Script Web App)。

## 需求

- 後台是純靜態頁面,沒有自己的伺服器,需要一個能讀寫資料、又不需要維運的 API 層。
- 營運端習慣用 Google Sheet 直接看資料、手動修資料,不能把 Sheet 拿掉。
- 前台(Next.js)需要用 Supabase 當資料源,不可能去讀 Google Sheet。
- 因此需要一層同時滿足「Sheet 可讀可改」與「Supabase 有最新資料」的橋接。

## 選項與取捨

| 選項 | 取捨 |
| --- | --- |
| 後台直連 Supabase(前端持 anon key) | 需要在靜態頁面暴露 key、要處理 RLS,且營運端會失去 Sheet 介面。**未採用**。 |
| 只用 Google Sheet,前台也讀 Sheet | 前台效能與查詢能力太差。**未採用**。 |
| **Apps Script 當唯一 API,Sheet 寫入為主、Supabase 為鏡像** | 免維運、Sheet 保留、service role key 收在 Script Properties 不外洩。代價是兩份資料可能不一致。**採用**。 |

其他已定案的取捨:

- **Supabase 鏡像失敗不擋存檔**(commit `5143a62`):營運端存檔的順暢度優先於一致性。
  代價是不一致會靜默發生,見 [architecture.md](architecture.md) 第 4 節。
- **讀取優先 Supabase、Sheet 當 fallback**:讓後台看到的資料跟前台一致。
  代價是讀寫路徑主從相反。
- **POST 用 `Content-Type: text/plain`**:規避瀏覽器 CORS preflight,Apps Script Web App 不支援 OPTIONS。

## 定案(現況實作)

### 進入點

| 函式 | 說明 |
| --- | --- |
| `doGet(e)` | 回傳 `readData()` 的完整快照(9 個集合一次全給)。無參數、無分頁。 |
| `doPost(e)` | 依 `JSON.parse(e.postData.contents).action` 分派。 |
| `authorizeExternalRequests()` | 手動執行一次以取得 `UrlFetchApp` 授權,不是 API。 |

### 支援的 action

寫入類 action 一律 `{action, payload}`,刪除類一律 `{action, id}`。
`payload.id` 為空時由 `doPost` 補 `Date.now()`。

| action | Sheet | Supabase 鏡像 |
| --- | --- | --- |
| `saveVendor` / `deleteVendor` | `Vendors` | `vendors` |
| `saveOrder` / `deleteOrder` | `Orders` | `backend_orders` |
| `saveWebsite` / `deleteWebsite` | `Websites` | `websites` |
| `saveStockProduct` / `deleteStockProduct` | `StockProducts` | `products` + `product_categories` + `product_variants` + `product_images` |
| `savePreorderProduct` / `deletePreorderProduct` | `PreorderProducts` | 同上 |
| `saveProductTag` / `deleteProductTag` | `ProductTags` | `categories` |
| `saveStallSchedule` / `deleteStallSchedule` | `StallSchedules` | `stall_schedules` |
| `saveConnectionSchedule` / `deleteConnectionSchedule` | `ConnectionSchedules` | `connection_schedules` |
| `saveScheduleSetting` | `ScheduleSettings` | `schedule_settings` |
| `getExchangeRates` | — | — |

回應格式固定 `{status:'success'|'error', message?}`;
**只有** `saveStockProduct` / `savePreorderProduct` 會額外帶 `supabaseSync`
(內含 `savedId` 與圖片同步統計),其餘 action 的鏡像結果前端看不到。

`getExchangeRates` 會呼叫 `scrapeBankRates()` 去 findrate.tw 爬五家銀行牌告匯率,
但**後台前端沒有任何地方呼叫這個 action**,目前是死程式碼。
匯率報表實際走另一條路,見 [module-exchange-rates.md](module-exchange-rates.md)。

### Sheet 操作

| 函式 | 行為 |
| --- | --- |
| `getOrCreateSheet(name)` | 工作表不存在就建立;表頭缺欄位就自動補到最右邊。所以加欄位只要改 `SHEET_HEADERS`。 |
| `getSheetData(name)` | 全表讀出轉物件陣列,`JSON_FIELDS` 的欄位自動 `JSON.parse`,失敗時陣列欄位退回 `[]`。 |
| `saveRow(name, payload)` | 以 `id` 比對(字串比較)決定 update 或 append;自動維護 `createdAt` / `updatedAt`;payload 有新 key 會自動加欄位。 |
| `deleteRow(name, id)` | 以 `id` 找列刪除,只刪第一筆命中。 |

### Supabase 同步

| 函式 | 行為 |
| --- | --- |
| `getSupabaseConfig(required)` | 從 Script Properties 讀 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`,缺就丟錯。 |
| `isSupabaseConfigured()` | 沒設定時整個系統退回純 Sheet 模式。 |
| `supabaseRequest(path, method, payload, prefer)` | PostgREST 呼叫封裝,非 2xx 丟錯。`product_images` 相關請求會額外印 log。 |
| `safeSupabaseMirror(label, cb)` | 包住所有鏡像呼叫,吞例外只印 warn,回 `{ok:false,error}`。 |
| `upsertSupabaseMirrorRow(table, payload)` | `on_conflict=legacy_id` + `resolution=merge-duplicates` 的通用 upsert。 |
| `deleteSupabaseMirrorRow(table, id)` | 以 `legacy_id` 刪除。 |

商品鏡像(`syncSupabaseProduct`)是唯一有多表關聯的流程:

```
products upsert(on_conflict=legacy_id) → 取得 saved.id (uuid)
  → syncSupabaseProductCategories(saved.id, tagIds)  // 先 DELETE 全部再 POST
  → syncSupabaseProductVariants(saved.id, ...)       // 先 DELETE 全部再 POST
  → syncSupabaseProductImages(saved.id, ...)         // 先 DELETE 全部再 POST
```

upsert 沒回 id 時會 `getSupabaseProductByLegacyId()` 補查,仍然沒有就丟錯。

### 圖片 URL 正規化(Apps Script 端)

`normalizeProductImageUrl()` 的規則:

- `data:image/...` → 丟棄(不允許 base64 進資料庫)
- `http(s)://...` → 原樣保留(Cloudinary 圖走這條)
- 其餘 → 視為本機相對路徑,強制正規化為 `/images/xxx`,並檢查副檔名白名單
  (`avif|gif|jpe?g|png|svg|webp`)與 `..` 路徑穿越

## 資料源與呼叫關係

```
後台前端 ──POST/GET──► Apps Script Web App
                          ├──► Google Sheet(SpreadsheetApp,同一份試算表)
                          ├──► Supabase PostgREST(UrlFetchApp + service role key)
                          └──► findrate.tw(scrapeBankRates,目前未被使用)
```

Apps Script **不會**呼叫 Cloudinary,圖片一律由前端經前台 `/api/upload` 處理,
Apps Script 只收到最終 URL 與 `publicId`。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-03](risk-review.md#r-03) `S1` Supabase 鏡像失敗被靜默吞掉,所有 action 都應回傳 `supabaseSync`。
- [ ] [R-07](risk-review.md#r-07) `S2` 關聯表「先刪後插」無交易保護。
- [ ] [R-11](risk-review.md#r-11) `S2` `saveRow` 全表讀寫,會撞 Apps Script 執行時間上限。
- [ ] [R-27](risk-review.md#r-27) `S4` `deleteRow` 只刪第一筆命中的列。
- [ ] [R-28](risk-review.md#r-28) `S4` `getExchangeRates` / `scrapeBankRates` 是死程式碼。
