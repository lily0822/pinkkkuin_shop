# 模塊:叫貨管理(叫貨處、廠商叫貨明細、購物網站叫貨明細)

> 本文為既有模塊的回溯整理。

對應選單:叫貨管理 → 叫貨處管理 / 廠商叫貨明細 / 購物網站叫貨明細。
主要程式:`lily-backend.html:2373-2523`(主檔)、`6006-6270`(明細)、`6379-6743`(批次與編輯)。
`daniel-backend.html` 是同一套介面的獨立副本,見 [module-legacy-portal.md](module-legacy-portal.md)。

## 需求

- 管理兩類進貨來源:**廠商**(`Vendors`,實體/代購廠商)與 **購物網站**(`Websites`,線上購物平台,多一個 `link` 欄位)。
- 記錄每筆叫貨單:日期、來源、訂單編號、物流單號、出貨狀態,以及底下多個品項。
- 品項層級也要能各自標記出貨狀態(同一張單可能分批出貨)。
- 支援 Excel 批次匯入(代購常見的整批商品清單)。
- 支援批次編輯與批次刪除品項。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| 廠商與購物網站分表? | **分表**(`Vendors` / `Websites`),因為購物網站多一個 `link` 欄位且篩選條件不同。但**訂單共用同一張 `Orders` 表**,靠 `vendorId` 指向哪張主檔來區分。 |
| 訂單品項存法 | 存成 `Orders.items` 的 JSON 陣列,不另開品項表。理由:品項不需要獨立查詢。代價:無法對品項做 SQL 層級的篩選,全部得在前端算。 |
| 單頭資訊 | `fetchAPI` 在送出 `saveOrder` 前,會把單頭(orderNo / trackingNo / shipped / shippedDate)包成一筆 `{isMeta:true}` 塞到 `items[0]`。這是為了讓只讀 items 的舊消費端也拿得到單頭。 |
| Excel 匯入 | 用 SheetJS 在前端解析,不上傳檔案。欄位位置**寫死**(見下),沒有欄位對應設定。 |
| 出貨狀態型別 | 存字串 `'已出貨'` / `'未出貨'`(品項層是 `'是'` / `'否'`),不是 boolean。歷史遺留,前端多處要做字串比對。 |

## 定案(現況實作)

### 主檔管理(叫貨處管理)

同一頁上下兩區:上方廠商(`renderVendors`)、下方購物網站(`renderWebsites`)。
彈窗新增/編輯,欄位:名稱、聯繫方式、地點、幣種(TWD/JPY/KRW/CNY)、備註;
購物網站多一個網址。

### 訂單資料結構

```js
{
  id, date, vendorId, orderNo, trackingNo,
  shipped: '已出貨' | '未出貨', shippedDate,
  items: [
    { isMeta: true, orderNo, trackingNo, shipped, shippedDate },  // 單頭鏡像
    { itemId, name, link, price, qty, tracking, shipped }         // 實際品項
  ]
}
```

### 明細頁

| 頁面 | 資料來源 | 篩選 |
| --- | --- | --- |
| 廠商叫貨明細 | `orders` 中 `vendorId` 屬於 `Vendors` 者 | 廠商、品項名稱、日期區間 |
| 購物網站叫貨明細 | `orders` 中 `vendorId` 屬於 `Websites` 者 | 廠商、品項名稱、日期區間、出貨狀態 |

列表為可展開的兩層結構(`toggleOrderRow`):訂單列展開後顯示品項列。
出貨狀態直接點按鈕切換(`toggleOrderStatus` / `toggleItemShipped`),
會先改按鈕外觀再打 `saveOrder`(樂觀更新,失敗不回滾)。

### Excel 批次匯入(`handleExcelUpload`)

讀第一個工作表,`header:1` 取原始二維陣列,**欄位位置寫死**:

| 欄 index | 意義 |
| --- | --- |
| 0 | 物流單號(僅第 0/1 列取,用來自動填單頭) |
| 1 | 訂單編號(同上) |
| 2 | 商品名稱(空白則整列略過) |
| 3 | 網址 |
| 4 | 單價 |
| 5 | 數量(預設 1) |
| 6 | 是否已出貨(`是`/`Y`/`Yes` → 是) |

表頭偵測靠字串比對(第 0 列且名稱含「商品」或「名稱」就跳過),不是嚴謹的解析。
匯入後只是把資料填進批次新增彈窗的列,使用者仍須確認後才存檔。

### 批次操作

| 功能 | 函式 |
| --- | --- |
| 批次新增訂單 | `openBatchAddModal` / `saveBatchOrder` |
| 批次刪除品項 | `batchDeleteItems` |
| 批次編輯品項 | `batchEditItems` / `saveBatchEdit` |
| 編輯單頭 | `openEditOrderMainModal` / `saveEditOrderMain` |

## 資料源與呼叫關係

```
叫貨管理
  ├─ 讀:loadData() → readSupabaseVendors / readSupabaseWebsites / readSupabaseBackendOrders
  │      (fallback: Vendors / Websites / Orders 工作表)
  ├─ 寫:fetchAPI('saveVendor'|'deleteVendor')   → Vendors 工作表 + vendors 鏡像
  ├─ 寫:fetchAPI('saveWebsite'|'deleteWebsite') → Websites 工作表 + websites 鏡像
  ├─ 寫:fetchAPI('saveOrder'|'deleteOrder')     → Orders 工作表 + backend_orders 鏡像
  └─ Excel:純前端 SheetJS 解析,不上傳
```

注意 `Orders` / `backend_orders` 同時承載三種東西:叫貨單、客戶訂單
(`vendorId === 2026061002`)、商品目錄假訂單(`2026062001` / `2026062002`)。
明細頁靠 `vendorId` 過濾,詳見 [data-model.md](data-model.md) 第 6 節。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-12](risk-review.md#r-12) `S2` 出貨狀態切換是樂觀更新且失敗不回滾。
- [ ] [R-14](risk-review.md#r-14) `S3` `Orders` 表被三種用途共用,靠 magic id 分流。
- [ ] [R-19](risk-review.md#r-19) `S3` Excel 匯入欄位位置寫死,換格式就壞。
- [ ] [R-24](risk-review.md#r-24) `S4` 出貨狀態用中文字串且有兩套值域。
- [ ] [R-25](risk-review.md#r-25) `S4` `items[0]` 的 meta 列是隱性契約。
