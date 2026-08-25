# 模塊:匯率報表

> 本文為既有模塊的回溯整理。

對應選單:運營管理 → 匯率報表。
主要程式:`lily-backend.html:6744-6807`;另有一條**未使用**的 Apps Script 路徑
`lily-backend-Code.gs:876-940`(`scrapeBankRates`)。

## 需求

代購需要參考各家銀行的日幣(JPY)與人民幣(CNY)賣出匯率,用來估算成本與定價。

## 選項與取捨

| 選項 | 取捨 |
| --- | --- |
| Apps Script 爬 findrate.tw 取得各家銀行**實際牌告** | 已實作(`scrapeBankRates`,action `getExchangeRates`),資料真實。但依賴第三方網站的 HTML 結構,對方改版就壞;且爬取失敗時整個 try/catch 直接吞掉、回傳空字串。**目前未被前端使用。** |
| **前端直接打 open.er-api.com 取市場中價,再加上寫死的銀行價差推估** | 免後端、速度快、不會被 HTML 改版影響。**採用中。** 但銀行匯率是**推估值不是牌告值**。 |

兩條路徑同時存在於程式碼中,是明確的重複與混淆。

## 定案(現況實作)

`fetchExchangeRates()`:

```js
const res = await fetch('https://open.er-api.com/v6/latest/TWD');
const baseJpy = 1 / data.rates.JPY;   // 1 日圓 = ? 台幣
const baseCny = 1 / data.rates.CNY;
// 各銀行 = 中價 + 寫死的價差
```

寫死的八家銀行與價差:

| 銀行 | JPY 價差 | CNY 價差 |
| --- | --- | --- |
| 台灣銀行 | 0.0010 | 0.030 |
| 中國信託 | 0.0015 | 0.035 |
| 國泰世華 | 0.0012 | 0.032 |
| 星展銀行 | 0.0018 | 0.038 |
| 台新銀行 | 0.0014 | 0.033 |
| 台北富邦 | 0.0013 | 0.034 |
| 聯邦銀行 | 0.0014 | 0.034 |
| 樂天銀行 | 0.0011 | 0.031 |

顯示到小數第 4 位,並標記最後更新時間。
`initExchangeRates()` 在表格為空時自動抓一次;另有「更新匯率」按鈕手動觸發。

畫面下方已有免責說明:「匯率資料源自即時市場公開 API,並加上各家銀行表定手續費差額推算」。

### 未使用的 Apps Script 路徑

`scrapeBankRates()` 抓 `findrate.tw/JPY/` 與 `findrate.tw/CNY/`,
用正規表達式抓取列,取第 5 欄(即期賣出),沒有就退回第 3 欄(現鈔賣出),
支援五家銀行(中國信託、台灣銀行、第一、兆豐、玉山)。
**後台前端沒有任何地方呼叫 `getExchangeRates`。**

## 資料源與呼叫關係

```
匯率報表頁 ──GET──► https://open.er-api.com/v6/latest/TWD  (無金鑰的公開 API)
                     ↓
                 中價 + 寫死價差 → 畫面(不儲存)

(未使用)Apps Script getExchangeRates ──► findrate.tw
```

匯率資料**不寫入任何資料庫**,每次都即時取得。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-23](risk-review.md#r-23) `S3` 顯示的是推估值而非牌告值,且單一 API 無備援、價差表寫死。
- [ ] [R-28](risk-review.md#r-28) `S4` Apps Script 的 `scrapeBankRates` 是死程式碼,需決定接回或移除。

一般待辦:

- [ ] 沒有歷史匯率保存,無法回頭查某天用的匯率。
