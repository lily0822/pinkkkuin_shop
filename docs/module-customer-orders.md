# 模塊:客戶訂單明細

> 本文為既有模塊的回溯整理。

對應選單:訂單管理 → 客戶訂單明細。
主要程式:`lily-backend.html:6271-6378`。

## 需求

- 檢視客戶下的訂單(相對於「叫貨單」是進貨方向,客戶訂單是出貨方向)。
- 與叫貨明細共用同一套展開式列表與出貨狀態切換介面。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| 客戶訂單要不要開新表? | **不開**。沿用 `Orders` 表,以固定的 `vendorId = 2026061002`(`CUSTOMER_ORDER_SOURCE_ID`)當作「客戶訂單」這個虛擬來源。理由:可以完全重用既有的訂單 CRUD 與介面。代價:語意錯位,`vendorId` 指向一個不存在於 `Vendors` 的 id。 |
| 與前台訂單的關係 | 前台結帳產生的訂單寫在 Supabase 的 `orders` / `order_items`,**本模塊完全不讀這兩張表**。目前是兩套獨立的訂單資料。 |

## 定案(現況實作)

```js
const CUSTOMER_ORDER_SOURCE_ID = 2026061002;
// renderCustomerOrders()
let customerOrders = orders.filter(o => Number(o.vendorId) === CUSTOMER_ORDER_SOURCE_ID);
```

介面與叫貨明細相同:可展開的訂單/品項兩層列表、篩選、出貨狀態切換、批次操作,
共用 `toggleOrderRow` / `toggleOrderStatus` / `toggleItemShipped` / `deleteOrder`。

## 資料源與呼叫關係

```
客戶訂單明細
  ├─ 讀:orders(來自 loadData → backend_orders / Orders 工作表)並在前端過濾 vendorId
  └─ 寫:fetchAPI('saveOrder' | 'deleteOrder')
```

**與前台 Supabase `orders` / `order_items` 無連動。**
前台購物車目前只存在瀏覽器 localStorage(`pinkkkuin_cart_items`),尚未產生正式訂單。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-14](risk-review.md#r-14) `S3` `Orders` 表被三種用途共用、靠 magic id 分流,`CUSTOMER_ORDER_SOURCE_ID` 亦屬此列。

一般待辦:

- [ ] 決定客戶訂單的最終資料源:繼續用 `backend_orders` + magic id,還是改讀前台的 `orders` / `order_items`。前台結帳一旦上線,兩套訂單並存會直接衝突。
- [ ] 目前沒有客戶主檔(姓名、聯絡方式、地址),客戶資訊只能塞在品項或備註裡。
