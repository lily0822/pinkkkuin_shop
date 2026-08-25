# 模塊:Portal 入口與 legacy 頁面

> 本文為既有模塊的回溯整理。

檔案:`index.html`、`stalls.html` + `script.js`、`connection.html`、
`accounting.html`、`daniel-backend.html`、`style.css`。

## 需求

`workspace` repo 最初是「麗與牛工作區域」的共用工具站,後來商品站後台(`lily-backend.html`)
長成主線,其餘頁面留下來成為 legacy。本文把這些頁面的定位與現況記錄清楚,
避免誤以為它們是商品站後台的一部分。

## 現況總表

| 檔案 | 用途 | 資料源 | 狀態 |
| --- | --- | --- | --- |
| `index.html` | Portal 入口,四張卡片 | 無 | 使用中 |
| `lily-backend.html` | **商品站後台(主線)** | Apps Script → Sheet + Supabase | 使用中 |
| `daniel-backend.html` | 大牛後台 | **另一個** Apps Script Web App | 使用中,但獨立 |
| `stalls.html` + `script.js` | 擺攤費用紀錄 | **localStorage `marketData`** | legacy |
| `connection.html` | 連線區域 | 無 | 「網頁建置中」佔位頁 |
| `accounting.html` | 集運帳表 | 無 | 「此為版面預覽,尚未連接資料庫」 |
| `style.css` | 全站共用樣式(不含兩個 backend 頁,它們有自己的 inline style) | — | 使用中 |

## `index.html` — Portal

四張卡片:連線區域(`connection.html`)、擺攤區域(`stalls.html`)、
麗麗後台(`lily-backend.html`)、大牛後台(`daniel-backend.html`)。
純靜態,無任何邏輯。

## `daniel-backend.html` — 大牛後台

**與 `lily-backend.html` 是兩套獨立系統**,不共用資料:

| | 麗麗後台 | 大牛後台 |
| --- | --- | --- |
| Apps Script | `AKfycbyC48NPyP1...` | `AKfycbxfSGNNWO2D...` |
| Google Sheet | Production Sheet | 另一份 Sheet |
| Supabase 鏡像 | 有 | 未知(該 Apps Script 的原始碼不在本 repo) |
| 環境切換 | 有(`backend-env.local.js`) | **無,URL 完全寫死** |
| 功能 | 完整(商品/標籤/品牌/時程/帳表/訂單) | 只有叫貨管理 + 集運帳表 |
| 行數 | 6810 | 1695 |

大牛後台的 Apps Script 原始碼**沒有版控在本 repo**(本 repo 只有 `lily-backend-Code.gs`)。

## `stalls.html` + `script.js` — legacy 擺攤紀錄

記錄市集擺攤的費用分攤:月份、起訖日、主辦、地點、參與人(麗/牛)、攤位數、
總金額、每攤金額、是否已付、付款人、是否結清、備註。

- 資料**只存在 localStorage key `marketData`**,無後端。
- `script.js` 內含 36 筆從 2025/04 到 2026/10 的**硬編碼預設資料**(`defaultData`),
  localStorage 為空時使用。
- 與後台的「擺攤時程」([module-schedules.md](module-schedules.md))**是完全不同的資料**:
  這裡記的是費用分攤,後台記的是活動時程與攤位費。

## `connection.html` / `accounting.html`

兩個佔位頁,沒有任何資料邏輯:

- `connection.html`:顯示「網頁建置中」。
- `accounting.html`:有完整的集運單表單畫面,但 `saveOrder()` 直接 `alert('此為版面預覽，尚未連接資料庫')`。

## 部署

全部檔案由 `.github/workflows/static.yml` 一次性上傳整個 repo 根目錄到 GitHub Pages,
所以 legacy 頁面都是**公開可存取**的:

- `https://lily0822.github.io/workspace/`
- `https://lily0822.github.io/workspace/lily-backend.html`
- `https://lily0822.github.io/workspace/daniel-backend.html`
- 其餘 legacy 頁同理

**沒有任何認證機制**,知道網址就能開後台並操作資料。見後續待辦。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-01](risk-review.md#r-01) `S1` **後台完全沒有存取控制**,公開網址即可改正式資料。全 repo 最高優先。
- [ ] [R-09](risk-review.md#r-09) `S2` `stalls.html` 只存 localStorage,且 `script.js` 硬編碼 36 筆真實營運資料。
- [ ] [R-13](risk-review.md#r-13) `S2` 大牛後台的 Apps Script 原始碼未版控。

一般待辦:

- [ ] `daniel-backend.html` 沒有環境切換,無法在 staging 驗證,且與麗麗後台有大量重複程式碼。
- [ ] `connection.html` / `accounting.html` 是無功能佔位頁,決定實作或從 Portal 移除。
