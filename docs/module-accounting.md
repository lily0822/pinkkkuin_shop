# 模塊:帳表管理(總帳表 / 集運帳表)

> 本文為既有模塊的回溯整理。

對應選單:帳表管理 → 總帳表 / 集運帳表 / 擺攤帳表 / 連線帳表。
主要程式:`lily-backend.html:2524-2768`(總帳表)、`1286-1475`(集運帳表)。

## 現況總表

| 子模塊 | 狀態 | 資料源 |
| --- | --- | --- |
| 總帳表 | **已實作** | **僅 localStorage `pinkkkuin_general_ledger`** |
| 集運帳表 | 只有畫面,存檔按鈕直接關閉彈窗不寫任何資料 | 無 |
| 擺攤帳表 | 選單項目無 `onclick`,點了沒反應 | 無 |
| 連線帳表 | 同上 | 無 |
| `accounting.html`(legacy 獨立頁) | 存檔跳 `此為版面預覽，尚未連接資料庫` | 無 |

## 需求

- 記錄日常收支流水帳,能依日期區間、分類、關鍵字、收入/支出篩選,並顯示總支出/總收入/總營利。
- 集運帳表要記錄集運商、集運單號、收件人、集運費用、付款方式。
- 擺攤與連線各自的費用帳表。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| 總帳表要不要進後端? | 目前**沒有**。只寫 localStorage。推測是先做介面驗證流程,後端 schema 未定案。這是所有模塊中唯一**沒有備份、換瀏覽器就消失**的正式資料。 |
| 分類用固定清單還是可維護? | 固定七類:集運 / 訂貨 / 連線 / LINEPAY / 賣場 / 擺攤 / 其他。寫死在 HTML 的 `<option>` 與彈窗 checkbox 中。 |
| 分頁 | 前端分頁(`ledgerCurrentPage` / `ledgerPageSize`),不是後端分頁 —— 因為資料本來就全在前端。 |

## 定案(現況實作)

### 總帳表資料結構

```js
{ id: Date.now(), date: 'YYYY-MM-DD', category: '集運'|'訂貨'|'連線'|'LINEPAY'|'賣場'|'擺攤'|'其他',
  content: '內容說明', amount: 1234, type: 'income'|'expense', note: '備註' }
```

### 驗證(`saveLedgerEntry`)

日期、分類、內容說明必填;金額必須 > 0;必須選擇支出或收入。
分類與收支型別在彈窗中用「互斥的 checkbox」實作(`setExclusiveLedgerCheckbox`),
而非 radio。

### 功能

| 功能 | 函式 |
| --- | --- |
| 篩選(日期區間/分類/關鍵字/收支) | `applyLedgerFilters` / `ledgerMatchesAppliedFilters` |
| 統計(總支出/總收入/總營利) | `updateLedgerSummary` |
| 分頁 | `updateLedgerPagination` / `changeLedgerPage` / `changeLedgerPageSize` |
| 全選 / 批次刪除 | `toggleAllLedgerRows` / `deleteSelectedLedgerEntries` |
| 新增 / 編輯 / 刪除 | `openLedgerModal` / `saveLedgerEntry` / `deleteLedgerEntry` |

按「搜索」才套用篩選(`ledgerAppliedFilters` 與草稿分離),不是即時篩選。

### 集運帳表

`lily-backend.html:1431` 起的 `freightModal` 有完整表單(集運商 Howgowin / 大陸集運、
集運單號、收件人、費用、付款方式),但兩個按鈕都綁 `closeFreightModal()`,
**沒有任何儲存邏輯**。列表區也沒有渲染函式。

## 資料源與呼叫關係

```
總帳表  ──► localStorage 'pinkkkuin_general_ledger'   (唯一資料源,無後端)
集運帳表 ──► 無
擺攤帳表 ──► 未實作
連線帳表 ──► 未實作
```

與後端 Apps Script / Supabase / Google Sheet **完全沒有連動**。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-02](risk-review.md#r-02) `S1` 總帳表只存 localStorage —— 先加 JSON/CSV 匯出備份,再接後端。
- [ ] [R-22](risk-review.md#r-22) `S3` 集運 / 擺攤 / 連線帳表是無功能入口。
- [ ] [R-29](risk-review.md#r-29) `S4` 分類清單寫死在 HTML 兩處。

一般待辦:

- [ ] `accounting.html` 與後台的集運帳表功能重複,確認保留哪一個。
