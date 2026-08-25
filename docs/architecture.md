# 系統架構與資料源呼叫關係

## 1. 這個 repo 是什麼

`https://github.com/lily0822/workspace.git`,本機目錄 `pinkkkuin_dashboard`。

**定位:商品站(pinkkkuin_shop)的後台管理端。** 純原生 HTML / CSS / JavaScript,
沒有 `package.json`、沒有建置步驟、沒有測試框架,整個 repo 以靜態檔案形式部署到 GitHub Pages。

需要補充的一點:此 repo 除了商品站後台(`lily-backend.html`)之外,還一併托管了
**大牛後台**(`daniel-backend.html`,獨立 Apps Script / 獨立 Google Sheet,只做叫貨與集運)
以及三個 legacy 靜態頁(`stalls.html` / `connection.html` / `accounting.html`)。
主線是商品站後台沒錯,但「這個 repo 只有商品站後台」並不精確,詳見
[module-legacy-portal.md](module-legacy-portal.md)。

## 2. 全域架構圖

```
                    ┌──────────────────────────────────────────┐
                    │  後台瀏覽器端 (lily-backend.html, 6800 行) │
                    │  原生 JS,狀態全在記憶體 + localStorage    │
                    └───┬───────────┬───────────┬──────────────┘
                        │           │           │
         (1) 業務資料    │           │ (2) 圖片   │ (3) 匯率
         GET / POST     │           │ 上傳/刪除  │ GET
                        ▼           ▼           ▼
        ┌───────────────────────┐  ┌──────────────────┐  ┌────────────────┐
        │ Apps Script Web App   │  │ pinkkkuin-shop   │  │ open.er-api.com│
        │ (lily-backend-Code.gs)│  │ /api/upload      │  │ /v6/latest/TWD │
        │  doGet / doPost       │  │ (Vercel, 前台)   │  └────────────────┘
        └───┬───────────────┬───┘  └────────┬─────────┘
            │               │               │
      寫入(主) │        鏡像(次) │               ▼
            ▼               ▼          ┌────────────┐
   ┌─────────────────┐  ┌──────────┐   │ Cloudinary │
   │ Google Sheet    │  │ Supabase │◄──┘ (圖片 CDN) │
   │ 9 個工作表      │  │ Postgres │   └────────────┘
   └─────────────────┘  └────┬─────┘
            ▲                │
            └── 讀取 fallback │ 讀取(主)
                             ▼
                    ┌──────────────────┐
                    │ 前台 pinkkkuin_  │
                    │ shop (Next.js)   │
                    │ Vercel           │
                    └──────────────────┘
```

## 3. 三條對外呼叫路徑

### (1) 業務資料 → Apps Script Web App

唯一的業務資料 API。定義於 `lily-backend.html:2007-2011`:

```js
const PRODUCTION_BACKEND_API_URL = 'https://script.google.com/macros/s/AKfycby.../exec';
const LOCAL_BACKEND_API_URL = String(window.PINKKKUIN_BACKEND_API_URL || '').trim();
const API_URL = LOCAL_BACKEND_API_URL || PRODUCTION_BACKEND_API_URL;
```

- **讀**:`loadData()` 對 `API_URL` 發 `GET` → Apps Script `doGet()` → `readData()`。
- **寫**:`fetchAPI(action, payload, id)` 發 `POST`(`Content-Type: text/plain` 以規避 CORS preflight)
  → Apps Script `doPost()` 依 `data.action` 分派。
- 所有 action 一覽見 [module-backend-api.md](module-backend-api.md)。

### (2) 圖片 → 前台的 `/api/upload` → Cloudinary

後台**不直接**碰 Cloudinary,而是打前台 Next.js 的上傳端點(`lily-backend.html:2026`):

```js
const PRODUCT_UPLOAD_API_URL = window.PINKKKUIN_UPLOAD_API_URL
  || (isLocalhost ? 'http://127.0.0.1:3000/api/upload'
                  : 'https://pinkkkuin-shop.vercel.app/api/upload');
```

`POST`(multipart)上傳、`DELETE`(JSON `{publicIds}`)刪除。細節見
[module-media-upload.md](module-media-upload.md)。

### (3) 匯率 → open.er-api.com

`fetchExchangeRates()` 直接打公開匯率 API,再套死在前端的銀行價差表推估。
見 [module-exchange-rates.md](module-exchange-rates.md)。

## 4. 資料流:寫入路徑與讀取路徑**不對稱**

這是本系統最需要注意的架構特性。

### 寫入(Google Sheet 為主,Supabase 為鏡像)

```
後台 POST {action:'saveStockProduct', payload}
  → doPost()
    → applyProductImages(payload)        // 正規化圖片、決定主圖
    → saveRow(SHEET_STOCK_PRODUCTS, ...) // ① 先寫 Google Sheet
    → safeSupabaseMirror(...)            // ② 再鏡像到 Supabase
        → syncSupabaseProduct()
            → products (upsert on legacy_id)
            → product_categories (先刪後插)
            → product_variants   (先刪後插)
            → product_images     (先刪後插)
```

`safeSupabaseMirror()`(`lily-backend-Code.gs:90`)把 Supabase 例外**吞掉並只記 log**,
回傳 `{ok:false, error}`。設計意圖是「Supabase 掛了不要擋住後台存檔」
(見 commit `5143a62 Do not block saves on Supabase mirror failures`)。

### 讀取(Supabase 為主,Google Sheet 為 fallback)

```js
function readData() {
  try { if (isSupabaseConfigured()) return readSupabaseData(); }
  catch (error) { console.warn('Supabase read failed, fallback to Google Sheets'); }
  return { ...getSheetData(每個工作表) };
}
```

### 由此產生的風險(重點)

> 完整說明與建議處置見 [risk-review.md](risk-review.md)。

1. **鏡像失敗會造成靜默不一致**([R-03](risk-review.md#r-03)):寫入成功寫進 Sheet,但 Supabase 鏡像失敗時後台仍顯示「成功」;
   之後讀取走 Supabase,使用者看到的是舊資料,而 Sheet 已經是新的。
   目前只有 `saveStockProduct` / `savePreorderProduct` 會把 `supabaseSync` 結果回傳給前端,
   其餘 action 完全看不到鏡像結果。
2. **前台只讀 Supabase**,所以「後台存檔成功」不等於「前台會更新」。判斷前台是否生效必須看 Supabase。
3. **先刪後插**([R-07](risk-review.md#r-07)):`product_categories` / `product_variants` / `product_images` 的同步是
   「刪掉該商品全部,再整批插入」。中途失敗會留下缺資料的商品。
4. `product_images` 只同步**有 `publicId`** 的圖片(`syncSupabaseProductImages`),
   純 URL、無 public_id 的圖片會在鏡像時被丟掉。

## 5. 瀏覽器端的資料保存

| 用途 | localStorage key | 是否為正式資料源 |
| --- | --- | --- |
| 後端資料整包快取(開頁先畫舊資料) | `pinkkkuin_backend_cache` | 否,快取 |
| 商品標籤 / 現貨 / 預購 快取 | `pinkkkuin_product_tags` / `pinkkkuin_stock_products` / `pinkkkuin_preorder_products` | 否,快取 |
| 擺攤 / 連線時程 快取 | `pinkkkuin_stall_schedules` / `pinkkkuin_connection_schedules` | 否,快取 |
| 時程與商品預設圖 | `pinkkkuin_schedule_default_images` | 否,快取 |
| 品牌設定 | `pinkkkuin_brand_settings` | 否,快取 |
| **總帳表** | `pinkkkuin_general_ledger` | **是,目前唯一資料源** |
| 擺攤紀錄(legacy `stalls.html`) | `marketData` | **是,目前唯一資料源** |

`loadData()` 的策略是「有快取先畫快取 → 再打 API → 用 API 結果覆蓋」,
所以換瀏覽器/清快取不會掉資料,**除了上表中標記為「是」的兩項**。

## 6. `scheduleSettings` 被當成通用 KV 表

`schedule_settings` 原本只是「擺攤/連線預設圖」,現在被複用成整個站台的設定表:
以 `type` 當 key、`image` 欄位塞 JSON 字串當 value。目前使用中的 `type`:

`stall` / `connection` / `product-default` / `product-default-scale` /
`brand` / `brand-logo-library` / `brand-logo` / `brand-logo-scale` /
`brand-watermark` / `brand-text-image` / `site-info` / `site-announcements` /
`site-banners` / `homepage-sections` / `site-navigation`

解析與序列化集中在 `lily-backend.html:2150-2295`(`applyBackendData` / `currentBackendDataSnapshot`)。
這是刻意的取捨:不動 Apps Script 與 Supabase schema 就能加新設定,代價是欄位語意錯位、
`image` 欄位實際存的是 JSON。詳見 [module-brand-appearance.md](module-brand-appearance.md)。

## 7. 外部相依

| 相依 | 用途 | 載入方式 |
| --- | --- | --- |
| SheetJS `xlsx` 0.18.5 | 叫貨明細的 Excel 批次匯入 | cdnjs |
| SortableJS 1.15.2 | 標籤 / 導覽列拖曳排序 | jsdelivr |
| Font Awesome 6.4.0 | 圖示 | cdnjs |
| Google Fonts (Inter) | 字型 | fonts.googleapis.com |

全部走 CDN,無 bundler、無 lockfile。

## 8. 相關文檔

- 環境與分支:[environments.md](environments.md)
- 風險清單:[risk-review.md](risk-review.md)
- 欄位對應:[data-model.md](data-model.md)
- API 明細:[module-backend-api.md](module-backend-api.md)
