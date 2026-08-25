# 環境、分支與部署

資料來源:`latest-info.md`(2026-08-25 盤點)+ 實際程式碼與 `.github/workflows/static.yml`。

## 1. 分支策略(重要)

| 分支 | 定位 | 部署目標 |
| --- | --- | --- |
| `main` | **開發分支**。日常提交、功能開發、staging 驗證都在這裡。 | staging(Vercel Preview `/backend`) |
| `release/workspace` | **正式環境部署分支**。只從 `main` 合併已驗證完成的內容。 | production(GitHub Pages) |
| `release/2026-08-25` | 2026-08-25 的一次性 release 快照,保留備查。 | 無 |

規則:

- 功能開發、修 bug 一律進 `main`。
- 要上正式站時,把 `main` 合併進 `release/workspace` 並推送,由該分支觸發 GitHub Pages 部署。
- **不要直接 push 到 `release/workspace`**;它只接受來自 `main` 的合併。

### 現況落差(待處理)

`.github/workflows/static.yml` 目前設定為:

```yaml
on:
  push:
    branches: ["main"]
```

也就是**推 `main` 就會直接部署到正式 GitHub Pages**,與上表的分支策略不符。
要落實此策略,需要:

1. 建立 `release/workspace` 分支(自 `main`)。
2. 把 workflow 的 `branches` 改成 `["release/workspace"]`。

在完成這兩步之前,`main` 仍等同正式部署分支,推送前必須自行確認內容可上線。
此項列為待辦,見本文第 6 節。

## 2. 前後台兩個 repo

| | 前台(商品站) | 後台(本 repo) |
| --- | --- | --- |
| Repo | `github.com/lily0822/pinkkkuin_shop.git` | `github.com/lily0822/workspace.git` |
| 技術 | Next.js | 原生 HTML/JS,無建置 |
| 開發分支 | `official-next` | `main` |
| 正式部署分支 | `official-next` → Vercel Production | `release/workspace` → GitHub Pages |
| 本機工作目錄 | `C:\Users\lily.deng\Desktop\pinkkkuin_shop` | `...\pinkkkuin_shop.backend-product-publish` |

`C:\Users\lily.deng\Desktop\AITEST` 是 legacy 備份,**不再開發 / 不部署 / 不當來源**。

## 3. 三套環境

### Production(正式)

| 項目 | 值 |
| --- | --- |
| 後台網址 | `https://lily0822.github.io/workspace/lily-backend.html` |
| 部署平台 | GitHub Pages(來源分支:目標為 `release/workspace`,現況為 `main`) |
| 業務 API | Production Apps Script Web App(URL 寫死在 `lily-backend.html:2007`) |
| 資料庫 | Production Supabase + Production Google Sheet |
| 前台 | `https://pinkkkuin-shop.vercel.app`(Vercel Production) |
| 環境標記 | 不顯示 badge |

### Staging

| 項目 | 值 |
| --- | --- |
| 後台網址 | `https://pinkkkuin-staging.vercel.app/backend` |
| 部署平台 | Vercel Preview 的 `/backend` route(內容仍取自 `.backend-product-publish/lily-backend.html`) |
| 業務 API | staging Apps Script Web App,由 Vercel Preview env `STAGING_BACKEND_API_URL` 注入 |
| 資料庫 | `pinkkkuin-staging` Supabase + Staging Google Sheet |
| 前台 | `https://pinkkkuin-staging.vercel.app` |
| 環境標記 | 顯示 `STAGING` badge |

TEST 商品 / TEST IP / TEST 類別**只能寫進 staging Supabase**。

### 本機

| 項目 | 值 |
| --- | --- |
| 後台 | 用本機 HTTP server 開 `http://127.0.0.1:xxxx/lily-backend.html` |
| 前台 | `http://127.0.0.1:3000` |
| 業務 API | 由 `backend-env.local.js` 指定的 staging Apps Script |
| 上傳 API | `http://127.0.0.1:3000/api/upload`(hostname 是 localhost 時自動切換) |
| 資料庫 | staging Supabase |

## 4. 環境切換機制(程式面)

`lily-backend.html:14-17` 只在 localhost 才載入本機覆寫檔:

```js
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  document.write('<script src="./backend-env.local.js"><\/script>');
}
```

`backend-env.local.js` 已被 `.gitignore`,範本是 `backend-env.example.js`:

```js
window.PINKKKUIN_BACKEND_ENV = 'STAGING';
window.PINKKKUIN_BACKEND_API_URL = 'https://script.google.com/macros/s/YOUR_STAGING_DEPLOYMENT_ID/exec';
```

解析順序(`lily-backend.html:2007-2012`):

1. `PINKKKUIN_BACKEND_API_URL` 有值 → 用它,環境視為 `STAGING`。
2. 沒值 → 用寫死的 `PRODUCTION_BACKEND_API_URL`,環境視為 `PRODUCTION`。

**安全閘門**(`fetchAPI`,`lily-backend.html:2287`):在 localhost 且被判定為 staging、
但 `LOCAL_BACKEND_API_URL` 是空的時候,直接丟錯誤,避免本機誤打正式 Apps Script:

> 本機 STAGING 後台尚未設定 backend-env.local.js 的 PINKKKUIN_BACKEND_API_URL,已阻止連到正式 Apps Script。

注意此閘門**只擋 `fetchAPI`(寫入)**,`loadData()` 的 GET 沒有走這個檢查。

環境 badge 由 `renderEnvironmentBadge()` 依 `IS_STAGING_BACKEND` 顯示。

## 5. 機密與環境變數保存位置

**本 repo 不含任何 key / secret**,只有一個公開的 Apps Script Web App URL(寫死在 HTML 內)。

| 位置 | 內容 |
| --- | --- |
| 本機 `.env`(前台) | 不再保存 Production Supabase 憑證 |
| 本機 `.env.local`(前台) | localhost 用的 staging 設定,git ignored |
| `backend-env.local.js`(本 repo) | 本機 staging backend 覆寫,git ignored |
| Vercel Production env | Production Supabase、Cloudinary、`UPLOAD_ALLOWED_ORIGIN` |
| Vercel Preview env | staging Supabase、`APP_ENV=staging`、`SUPABASE_ENV=staging`、`STAGING_BACKEND_API_URL` |
| Apps Script Production Script Properties | `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`(Production) |
| Apps Script Staging Script Properties | `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`(Staging) |

Apps Script 端讀取方式見 `lily-backend-Code.gs:356`(`getSupabaseConfig`),
缺任一項就丟錯,`isSupabaseConfigured()` 回 false 時整個系統退回純 Google Sheet 模式。

## 6. 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-05](risk-review.md#r-05) `S1` 建立 `release/workspace` 分支,並把 `static.yml` 的觸發分支由 `main` 改過去。
- [ ] [R-04](risk-review.md#r-04) `S1` `loadData()` 的 GET 也要套上與 `fetchAPI` 相同的環境閘門。
- [ ] [R-10](risk-review.md#r-10) `S2` Cloudinary 尚未拆 staging / production。
- [ ] [R-13](risk-review.md#r-13) `S2` `daniel-backend.html` 沒有環境切換機制,且其 Apps Script 未版控。
