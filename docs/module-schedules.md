# 模塊:擺攤 / 連線時程

> 本文為既有模塊的回溯整理。

對應選單:擺攤連線管理 → 擺攤時程 / 連線時程。
主要程式:`lily-backend.html:4607-4719`(預設圖)、`5774-6005`(時程 CRUD)。

## 需求

- **擺攤時程**:記錄市集名稱(period)、地點、攤位費,以及**多天**的擺攤日期與每天的起訖時間。
- **連線時程**:記錄連線名稱、地點、開始/結束日期、機票費、住宿費。
- 兩者都要能設定活動圖片,以及一張「沒設圖時用的預設圖」。
- 前台要顯示這些時程(`/category/live_order`)。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| 兩種時程合併還是分開? | **分開**兩張表(`StallSchedules` / `ConnectionSchedules`),因為時間模型不同:擺攤是「多天 + 每天時段」,連線是「單一起訖日期」。但介面共用同一組函式,以 `type` 參數分流。 |
| 擺攤的多天時間怎麼存? | 存成 `days` JSON 陣列 `[{date,startTime,endTime}]`。舊資料有一個扁平的 `time` 字串欄位,`normalizeStallDays()` 會把它轉成單天陣列,向下相容。 |
| 預設圖存哪? | 存進 `ScheduleSettings`(`type` = `stall` / `connection`)。這也是後來整個 `schedule_settings` 被當成通用 KV 表的起點,見 [module-brand-appearance.md](module-brand-appearance.md)。 |
| 寫入時機 | 樂觀更新:先改本地 + 關彈窗 + 重畫,再 `await fetchAPI(..., skipRender=true)`。失敗不回滾。 |

## 定案(現況實作)

### 資料結構

```js
// 擺攤
{ id, period, location, image, stallFee,
  days: [{ date: 'YYYY-MM-DD', startTime: 'HH:mm', endTime: 'HH:mm' }],
  createdAt, updatedAt }

// 連線
{ id, period, location, image, startDate, endDate, flightFee, hotelFee,
  createdAt, updatedAt }
```

`saveSchedule()` 送出的物件其實同時帶了兩種型別的所有欄位
(擺攤單也會帶 `flightFee`/`hotelFee`,只是值為 0),由 Apps Script 依 action 寫進對應工作表。

### 驗證

- 擺攤:`period`、`location` 必填,且 `days` 至少一筆。
- 連線:`period`、`location` 必填,且 `startDate` 與 `endDate` 都要有。

### 顯示

`scheduleTimeText()` / `scheduleTimeHtml()` 把時間格式化成帶星期的字串:

- 連線:`2026-08-21(五) ~ 2026-08-23(日)`
- 擺攤:每天一行,`2026-08-21(五) 11:00 - 20:00`

### 多天編輯

彈窗內用 `renderStallDayRows` / `addStallDayRow` / `removeStallDayRow` 動態增減日期列,
存檔時 `collectStallDays()` 收集,並過濾掉三個欄位全空的列。

### 篩選

`filteredSchedules(type)` 依地點關鍵字與時間關鍵字做前端字串比對,無日期區間篩選。

### 預設圖

`saveScheduleDefaultImage(type)` 呼叫 `saveScheduleSetting`,把 URL 存進
`ScheduleSettings` 的 `stall` / `connection` 兩筆。
另有 `product-default` / `product-default-scale` 供商品列表使用(`saveProductDefaultImage`)。

圖片 URL 一律先過 `normalizeProductImageUrl()`,`data:` URL 會被丟棄。

## 資料源與呼叫關係

```
時程管理
  ├─ 讀:loadData() → readSupabaseStallSchedules / readSupabaseConnectionSchedules
  │      (fallback: StallSchedules / ConnectionSchedules 工作表)
  ├─ 寫:fetchAPI('saveStallSchedule'|'deleteStallSchedule')
  │      fetchAPI('saveConnectionSchedule'|'deleteConnectionSchedule')
  ├─ 預設圖:fetchAPI('saveScheduleSetting') → ScheduleSettings / schedule_settings
  └─ 快取:localStorage pinkkkuin_stall_schedules / pinkkkuin_connection_schedules
```

**注意**:本模塊與 legacy 的 `stalls.html`(純 localStorage 的擺攤費用紀錄)是**兩套不相干的資料**,
見 [module-legacy-portal.md](module-legacy-portal.md)。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-09](risk-review.md#r-09) `S2` 與 legacy `stalls.html` 的擺攤紀錄資料重複,該頁只存 localStorage。
- [ ] [R-12](risk-review.md#r-12) `S2` 樂觀更新失敗不回滾,API 失敗後畫面仍顯示已儲存。

一般待辦:

- [ ] 時程的圖片欄位只接受 URL 輸入,沒有接上 Cloudinary 上傳流程(商品/品牌都已經有),操作不一致。
- [ ] `saveSchedule` 送出時混帶兩種型別的欄位,應依 `type` 只送必要欄位。
- [ ] 沒有日期區間篩選,時程累積後只能靠關鍵字找。
