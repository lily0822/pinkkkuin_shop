# 風險清單(Risk Review)

盤點日期:2026-08-25 · 對象:`main` 分支(商品站後台)
來源:程式碼靜態審視 + [env-snapshot-2026-08-25.md](env-snapshot-2026-08-25.md) 盤點紀錄。

本文是**唯一的風險登錄冊**。各模塊文檔的「後續待辦」若屬風險項,只保留一行並標註風險編號,
細節(影響、觸發條件、建議處置)一律看這裡。

## 嚴重度定義

| 等級 | 意義 |
| --- | --- |
| **S1 嚴重** | 已經可能造成資料遺失、資料外洩或正式站被誤改。應優先處理。 |
| **S2 高** | 在可預期的操作下會造成資料不一致或服務中斷。 |
| **S3 中** | 造成錯誤資料、誤解或維護成本,但有 workaround。 |
| **S4 低** | 技術債與體驗問題,不影響資料正確性。 |

## 總表

| ID | 嚴重度 | 分類 | 摘要 | 相關模塊 |
| --- | --- | --- | --- | --- |
| [R-01](#r-01) | S1 | 安全 | 後台完全沒有存取控制,公開網址即可改正式資料 | 全站 |
| [R-02](#r-02) | S1 | 資料遺失 | 總帳表只存 localStorage,清快取即全失 | accounting |
| [R-03](#r-03) | S1 | 一致性 | Supabase 鏡像失敗被靜默吞掉,後台顯示成功但前台不更新 | backend-api |
| [R-04](#r-04) | S1 | 安全 | `loadData()` 的 GET 未套「本機不得連正式 API」閘門 | environments |
| [R-05](#r-05) | S1 | 部署 | `main` 直接部署正式站,開發與正式未隔離 | environments |
| [R-06](#r-06) | S2 | 資料遺失 | 「陣列非空才覆蓋」使資料被刪光時前端保留舊資料 | product-management |
| [R-07](#r-07) | S2 | 資料遺失 | 關聯表「先刪後插」無交易保護,中途失敗留下殘缺商品 | backend-api |
| [R-08](#r-08) | S2 | 一致性 | 商品目錄雙寫成「假訂單」,兩份資料可能不同步 | product-management |
| [R-09](#r-09) | S2 | 資料遺失 | legacy `stalls.html` 只存 localStorage,且真實營運資料硬編碼在原始碼 | legacy-portal |
| [R-10](#r-10) | S2 | 環境隔離 | Cloudinary 未拆 staging / production,測試圖進正式空間 | media-upload |
| [R-11](#r-11) | S2 | 擴展性 | Apps Script 全表讀寫 + 批次逐筆呼叫,會撞執行時間上限 | backend-api |
| [R-12](#r-12) | S2 | 一致性 | 樂觀更新失敗不回滾,畫面與後端不一致 | purchasing / schedules |
| [R-13](#r-13) | S2 | 維運 | 大牛後台的 Apps Script 原始碼未版控 | legacy-portal |
| [R-14](#r-14) | S3 | 技術債 | `Orders` 表被三種用途共用,靠 magic id 分流 | purchasing |
| [R-15](#r-15) | S3 | 技術債 | `schedule_settings` 被當通用 KV 表,`image` 欄位存 JSON | brand-appearance |
| [R-16](#r-16) | S3 | 一致性 | `sold_out` 讀回變成 `active:false`,與「下架」無法區分 | product-management |
| [R-17](#r-17) | S3 | 一致性 | 刪除標籤未把受影響商品寫回後端 | product-tags |
| [R-18](#r-18) | S3 | 一致性 | `saveBrandSetting('logo')` 4 次序列呼叫,中途失敗不一致 | brand-appearance |
| [R-19](#r-19) | S3 | 穩定性 | Excel 匯入欄位位置寫死,換格式就壞 | purchasing |
| [R-20](#r-20) | S3 | 資料遺失 | 未儲存變更離開頁面不攔截 | product-tags / brand-appearance |
| [R-21](#r-21) | S3 | 維運 | 存檔成功但鏡像失敗時 Cloudinary 圖不回收,產生孤兒檔 | media-upload |
| [R-22](#r-22) | S3 | 體驗 | 集運 / 擺攤 / 連線帳表是無功能入口,使用者誤以為有存到 | accounting |
| [R-23](#r-23) | S3 | 正確性 | 匯率是推估值非牌告值,且單一 API 無備援 | exchange-rates |
| [R-24](#r-24) | S4 | 技術債 | 出貨狀態用中文字串且有兩套值域 | purchasing |
| [R-25](#r-25) | S4 | 技術債 | `items[0]` 的 meta 列是隱性契約 | purchasing |
| [R-26](#r-26) | S4 | 技術債 | 標籤 id 與商品 id 格式不一致 | product-tags |
| [R-27](#r-27) | S4 | 技術債 | `deleteRow` 只刪第一筆命中的列 | backend-api |
| [R-28](#r-28) | S4 | 技術債 | `getExchangeRates` / `scrapeBankRates` 是死程式碼 | exchange-rates |
| [R-29](#r-29) | S4 | 技術債 | 總帳分類清單寫死在 HTML 兩處 | accounting |
| [R-30](#r-30) | S4 | 安全 | 上傳無前端檔案大小 / 類型檢核 | media-upload |

---

## S1 嚴重

### R-01

**後台完全沒有存取控制**

- **現象**:`.github/workflows/static.yml` 把整個 repo 根目錄上傳到 GitHub Pages,
  `https://lily0822.github.io/workspace/lily-backend.html` 公開可存取,無登入、無 token。
  Apps Script Web App 也必須設為「任何人皆可存取」才能被靜態頁呼叫。
- **影響**:任何知道網址的人都能新增/修改/刪除正式商品、標籤、訂單、品牌設定,
  並連動寫入 Production Supabase,直接影響前台。
- **觸發條件**:網址被搜尋引擎索引、被分享、或被猜到(repo 是公開的,檔名一望即知)。
- **建議處置**:
  1. 短期:Apps Script `doPost` / `doGet` 加共享密鑰檢查(前端由 `backend-env` 注入),
     密鑰放 Script Properties;同時把 repo 轉為 private 並改用其他部署方式。
  2. 中期:後台改掛到前台 Vercel 的受保護路由,套真正的登入。
- **相關**:[module-legacy-portal.md](module-legacy-portal.md)

### R-02

**總帳表資料只在 localStorage**

- **現象**:`generalLedger` 只寫 `localStorage['pinkkkuin_general_ledger']`,
  沒有任何後端 action,`initGeneralLedger` / `persistGeneralLedger` 全在前端。
- **影響**:清瀏覽器資料、換裝置、換瀏覽器、無痕視窗 → 全部帳務紀錄消失且無法復原。
  這是全系統唯一沒有備份的**正式**資料(legacy `stalls.html` 見 R-09)。
- **觸發條件**:任何清快取行為;瀏覽器自動清理站台資料。
- **建議處置**:
  1. 立即:加 JSON / CSV 匯出與匯入,讓使用者能自行備份(成本低,可先擋著)。
  2. 正式:新增 `GeneralLedger` 工作表 + `saveLedgerEntry` / `deleteLedgerEntry` action
     + Supabase 鏡像,比照其他模塊。
- **相關**:[module-accounting.md](module-accounting.md)

### R-03

**Supabase 鏡像失敗被靜默吞掉**

- **現象**:`safeSupabaseMirror()`(`lily-backend-Code.gs:90`)catch 住所有例外,
  只 `console.warn` 並回傳 `{ok:false}`;`doPost` 仍回 `{status:'success'}`。
  只有 `saveStockProduct` / `savePreorderProduct` 會把 `supabaseSync` 帶回前端,
  且前端**沒有檢查這個欄位**。
- **影響**:寫入成功進 Google Sheet、鏡像失敗沒進 Supabase → 後台跳「已保存」,
  但讀取走 Supabase(見 [architecture.md](architecture.md) 第 4 節),
  使用者看到的是舊資料;前台只讀 Supabase,也不會更新。問題會延遲很久才被發現。
- **觸發條件**:Supabase 短暫不可用、schema 不符、service role key 過期、PostgREST 回 4xx。
- **建議處置**:
  1. 所有 action 都回傳 `supabaseSync`。
  2. 前端在 `ok:false` 時改顯示明確警告(「已存入試算表,但同步到資料庫失敗,前台尚未更新」)。
  3. 加一個「重新同步」按鈕,可對單筆或全量重跑鏡像。
- **相關**:[module-backend-api.md](module-backend-api.md)、[architecture.md](architecture.md)

### R-04

**`loadData()` 的 GET 未套環境閘門**

- **現象**:`fetchAPI()` 有防護(`lily-backend.html:2287`),在 localhost 且被判為 staging
  但 `PINKKKUIN_BACKEND_API_URL` 未設定時會擋下。但 `loadData()` 直接
  `await fetch(API_URL)`,沒有這道檢查。
- **影響**:本機開發者忘了建 `backend-env.local.js` 時,開頁就會讀 **Production** 資料,
  畫面上是正式商品;此時雖然寫入會被擋,但使用者可能誤以為自己在 staging,
  也可能因此把正式資料誤當測試資料操作。
- **觸發條件**:新環境第一次 clone、忘記複製 `backend-env.example.js`。
- **建議處置**:把閘門抽成 `assertBackendTarget()`,`loadData()` 與 `fetchAPI()` 共用;
  被擋下時在畫面顯示明確的設定指引,而不是只丟 alert。
- **相關**:[environments.md](environments.md)

### R-05

**`main` 直接部署正式站**

- **現象**:workflow 觸發條件是 `push: branches: ["main"]`,而 `main` 是日常開發分支。
  `release/workspace` 目前只是文件上的政策,分支尚未建立。
- **影響**:任何進 `main` 的提交(包含還沒驗證完的)會立刻上線到正式後台。
  沒有「已驗證」與「開發中」的界線。
- **觸發條件**:任何 `git push origin main`。
- **建議處置**:
  1. 自 `main` 建立 `release/workspace`。
  2. workflow 改 `branches: ["release/workspace"]`。
  3. 正式上線改為 `main → release/workspace` 的合併動作。
- **備註**:此項會改變部署行為,需先確認再執行。
- **相關**:[environments.md](environments.md)

---

## S2 高

### R-06

**「陣列非空才覆蓋」導致刪光時保留舊資料**

- **現象**:`applyBackendData()` 用 `if (Array.isArray(x) && x.length)` 判斷是否覆蓋
  `stockProducts` / `preorderProducts` / `productTags`。
- **影響**:後端資料被清空(或讀取失敗回空陣列)時,前端保留 localStorage 的舊資料,
  使用者看到「還在」;若接著存檔,舊資料會被**寫回**後端,等於還原了已刪除的資料。
- **觸發條件**:全部商品被刪除;Supabase 查詢回空;讀取路徑異常。
- **建議處置**:改用「後端有回這個 key 就覆蓋」(檢查 `key in data`),空陣列也要覆蓋。
- **相關**:[module-product-management.md](module-product-management.md)

### R-07

**關聯表「先刪後插」無交易保護**

- **現象**:`syncSupabaseProductCategories` / `syncSupabaseProductVariants` /
  `syncSupabaseProductImages` 都是先 `DELETE` 該商品全部關聯,再 `POST` 新的。
  PostgREST 呼叫之間沒有交易。
- **影響**:DELETE 成功、POST 失敗 → 商品在 Supabase 上變成沒有標籤 / 沒有變體 / 沒有圖片,
  前台直接顯示異常。且因為 R-03,後台仍顯示成功。
- **觸發條件**:網路中斷、Apps Script 逾時、payload 驗證失敗。
- **建議處置**:改用 Supabase RPC(單一 plpgsql function 內完成刪除與插入),
  或至少在插入失敗時把 `supabaseSync.ok=false` 明確回報並提示重試。
- **相關**:[module-backend-api.md](module-backend-api.md)

### R-08

**商品目錄雙寫成「假訂單」**

- **現象**:每次存商品除了寫 `StockProducts` / `PreorderProducts`,還會呼叫
  `syncProductCatalog()` 往 `Orders` 寫一筆固定 id 的假訂單
  (`2026062001` / `2026062002`),商品 meta 用 JSON 塞在 item 的 `tracking` 欄位。
- **影響**:同一份商品資料存在兩處且可能不同步;每次存檔多打一次 API(加劇 R-11);
  假訂單會出現在 `backend_orders` 中污染訂單資料。
- **觸發條件**:任何商品存檔;兩條路徑其中一條失敗時就開始分歧。
- **建議處置**:確認沒有其他消費者(前台不讀假訂單)後,移除
  `syncProductCatalog` / `hydrateProductCatalogsFromOrders`,並清掉既有的兩筆假訂單。
- **相關**:[module-product-management.md](module-product-management.md)

### R-09

**legacy `stalls.html` 只存 localStorage,且真實資料硬編碼**

- **現象**:資料只在 `localStorage['marketData']`;`script.js` 內含 36 筆
  2025/04–2026/10 的**真實擺攤費用紀錄**(金額、付款人、結清狀態)作為 `defaultData`。
- **影響**:
  1. 資料遺失風險同 R-02。
  2. 這些營運金額資料隨著公開 repo 與 GitHub Pages 一起對外公開。
- **觸發條件**:已經發生(repo 公開即外洩);清快取即資料遺失。
- **建議處置**:移除 `defaultData` 中的真實資料;決定此頁要合併進後台擺攤時程還是下架。
- **相關**:[module-legacy-portal.md](module-legacy-portal.md)

### R-10

**Cloudinary 未拆 staging / production**

- **現象**:`PRODUCT_UPLOAD_API_URL` 在非 localhost 時**一律**指向
  `https://pinkkkuin-shop.vercel.app/api/upload`,也就是 Production 前台;
  Cloudinary 帳號本身也未分環境。
- **影響**:staging 後台上傳的測試圖進入正式 Cloudinary 空間;
  刪除操作也可能誤刪正式圖(publicId 相同時)。
- **觸發條件**:在 staging 後台做任何圖片上傳或刪除。
- **建議處置**:短期至少依環境加 folder prefix(`staging/products/…`);
  中期讓 staging 前台提供自己的 `/api/upload`,由 Preview env 注入端點。
- **相關**:[module-media-upload.md](module-media-upload.md)

### R-11

**Apps Script 全表讀寫 + 批次逐筆呼叫**

- **現象**:`saveRow()` 每次都 `sheet.getDataRange().getValues()` 讀整張表;
  前端的批次操作(批次上下架、批次刪除、`saveProductTagsSettings` 全量寫回)
  都是 `for await` 逐筆呼叫 API。
- **影響**:商品/標籤數量成長後,單次操作耗時線性上升,會撞到 Apps Script
  的執行時間上限(6 分鐘)而中途失敗,留下部分寫入的狀態。
- **觸發條件**:商品數量成長;一次批次操作涵蓋較多筆。
- **建議處置**:`saveRow` 改為先讀 id 欄再針對性讀寫;
  新增支援陣列 payload 的批次 action,前端一次送出。
- **相關**:[module-backend-api.md](module-backend-api.md)、[module-product-management.md](module-product-management.md)

### R-12

**樂觀更新失敗不回滾**

- **現象**:出貨狀態切換(`toggleOrderStatus` / `toggleItemShipped`)與時程存檔
  (`saveSchedule` / `deleteSchedule`)都是先改畫面與本地狀態,再 `await fetchAPI(...)`,
  沒有 try/catch 也沒有回滾。(商品存檔 `saveProductRow` **有**做回滾,是正確範例。)
- **影響**:API 失敗時畫面顯示已更新、後端其實沒變;重新整理後變回舊值,
  使用者會以為系統「自己改回去」。
- **觸發條件**:網路不穩、Apps Script 逾時。
- **建議處置**:比照 `saveProductRow` 的 previous-snapshot 回滾模式統一處理。
- **相關**:[module-purchasing.md](module-purchasing.md)、[module-schedules.md](module-schedules.md)

### R-13

**大牛後台的 Apps Script 原始碼未版控**

- **現象**:repo 只有 `lily-backend-Code.gs`;`daniel-backend.html` 指向另一個
  Web App(`AKfycbxfSGNNWO2D...`),其後端程式碼只存在 Google 帳號中。
- **影響**:無法 review、無法還原、無法得知它是否也在寫 Supabase;
  該帳號一旦失去存取,功能無法重建。
- **觸發條件**:需要修改或還原大牛後台時。
- **建議處置**:匯出並加入 repo(例如 `daniel-backend-Code.gs`),同時評估與麗麗後台的重複程式碼。
- **相關**:[module-legacy-portal.md](module-legacy-portal.md)

---

## S3 中

### R-14

`Orders` / `backend_orders` 同時承載叫貨單、客戶訂單(`vendorId=2026061002`)與商品目錄假訂單
(`2026062001`/`2026062002`),靠 magic id 分流,任何漏過濾就會顯示錯資料。
**處置**:加 `kind` 欄位或拆表;magic id 至少集中定義並註記。
→ [module-purchasing.md](module-purchasing.md)、[module-customer-orders.md](module-customer-orders.md)

### R-15

`schedule_settings` 被當通用 KV 表,15 種 `type` 的值全塞在名為 `image` 的欄位裡(多數是 JSON 字串)。
Sheet 上無法閱讀,SQL 無法查詢單一設定欄位,`applyBackendData` 用 15 段 `else if` 分派。
**處置**:新增正式的 `site_settings`(`key` / `value` jsonb)表並提供遷移;分派改為對照表。
→ [module-brand-appearance.md](module-brand-appearance.md)

### R-16

Supabase 的 `status='sold_out'` 讀回時 `active: row.status === 'active'` → `false`,
與「手動下架」無法區分。庫存補回後商品仍顯示為下架。
**處置**:前端改保存 `status` 原值,或讀回時依 `stock_quantity` 還原語意。
→ [module-product-management.md](module-product-management.md)

### R-17

`deleteProductTag()` 會從記憶體中所有商品的 `tagIds` 移除該標籤,但**沒有把受影響的商品寫回後端**,
只有標籤本身被刪。Supabase 的 `product_categories` 關聯要等該商品下次被編輯才會清掉。
**處置**:刪標籤時一併同步受影響商品,或由 Apps Script 在 `deleteProductTag` 時連帶清關聯。
→ [module-product-tags.md](module-product-tags.md)

### R-18

`saveBrandSetting('logo')` 連續發 4 次 `saveScheduleSetting`
(`brand-logo` / `brand` / `brand-logo-library` / `brand-logo-scale`),中途失敗會讓部分 key 已更新。
**處置**:合併成單一 action,或失敗時回滾已寫入的 key。
→ [module-brand-appearance.md](module-brand-appearance.md)

### R-19

Excel 匯入的欄位位置寫死(第 0–6 欄),表頭偵測靠字串包含「商品」或「名稱」。
換一份格式就整批匯錯或匯不進來,且錯誤是靜默的(名稱空白直接略過該列)。
**處置**:改為表頭比對或提供欄位對應設定;匯入後顯示「共讀取 N 列、略過 M 列」。
→ [module-purchasing.md](module-purchasing.md)

### R-20

標籤設定與首頁內容都是「延後儲存」,未儲存時只有一行文字提示,離開頁面 / 切換分頁不攔截。
拖曳排序、批次編輯的成果很容易整批遺失。
**處置**:dirty 時加 `beforeunload` 攔截,並在切換分頁時提示。
→ [module-product-tags.md](module-product-tags.md)、[module-brand-appearance.md](module-brand-appearance.md)

### R-21

Cloudinary 圖只在「商品存檔失敗」時回收(`cleanupUploadedProductImages`);
若存檔成功但 Supabase 鏡像失敗(R-03),圖片已上傳卻沒有任何記錄指向它,成為孤兒檔。
`deleteCloudinaryImages()` 也一次送出全部 publicId,大量刪除時沒有分批。
**處置**:定期比對 Cloudinary 與 `product_images` 清理孤兒檔;刪除改分批。
→ [module-media-upload.md](module-media-upload.md)

### R-22

集運帳表的表單完整但兩個按鈕都綁 `closeFreightModal()`,**沒有任何儲存邏輯**;
擺攤帳表 / 連線帳表的選單項目沒有 `onclick`,點了完全沒反應;
`accounting.html` 存檔會跳「此為版面預覽,尚未連接資料庫」。
使用者可能以為資料有存到。
**處置**:實作儲存,或先把入口停用並標示「開發中」。
→ [module-accounting.md](module-accounting.md)

### R-23

匯率報表顯示的**不是銀行牌告匯率**,而是 `open.er-api.com` 的市場中價加上寫死在 JS 裡的價差推估。
八家銀行的價差是固定常數,銀行調整手續費不會反映。該 API 無 SLA 也無備援。
另有一條真正抓牌告的 Apps Script 路徑但未被使用(見 R-28)。
**處置**:二選一(接回 `scrapeBankRates` 或移除死程式碼);畫面已有免責說明,建議保留並加強。
→ [module-exchange-rates.md](module-exchange-rates.md)

---

## S4 低 / 技術債

### R-24

出貨狀態用中文字串而非 boolean,且**單頭用 `已出貨`/`未出貨`、品項用 `是`/`否`** 兩套值域。
→ [module-purchasing.md](module-purchasing.md)

### R-25

`Orders.items[0]` 是 `fetchAPI` 塞入的 `{isMeta:true}` 單頭鏡像列,是隱性契約,
任何直接操作 `items` 的程式都必須記得跳過它。
→ [module-purchasing.md](module-purchasing.md)

### R-26

標籤 id 是 `{timestamp}-{index}` 字串、商品 id 是數字,跨模塊比對全靠 `String()` 轉換(`sameId`)。
→ [module-product-tags.md](module-product-tags.md)

### R-27

`deleteRow()` 找到第一筆命中的 id 就 `break`,重複 id 會留下殘留資料。
→ [module-backend-api.md](module-backend-api.md)

### R-28

Apps Script 的 `getExchangeRates` / `scrapeBankRates` 是死程式碼(前端沒有任何地方呼叫),
且銀行清單與前端不一致(Apps Script 5 家、前端 8 家)。
→ [module-exchange-rates.md](module-exchange-rates.md)

### R-29

總帳分類清單(集運/訂貨/連線/LINEPAY/賣場/擺攤/其他)寫死在 HTML 兩處
(篩選 `select` 與彈窗 checkbox),新增分類要改兩個地方。
→ [module-accounting.md](module-accounting.md)

### R-30

上傳沒有前端的檔案大小 / 類型檢核,完全依賴前台 `/api/upload` 把關;
上傳失敗只做 `alert`,沒有重試。
→ [module-media-upload.md](module-media-upload.md)

---

## 建議處理順序

1. **R-01**(存取控制)—— 其餘所有風險的前提,先擋住外部寫入。
2. **R-02 / R-09**(localStorage 唯一資料源)—— 先加匯出備份,再接後端。
3. **R-05 / R-04**(環境隔離)—— 建 `release/workspace`、統一環境閘門,之後的修改才安全。
4. **R-03 / R-06 / R-07**(一致性)—— 讓失敗可見、讓覆蓋語意正確、讓關聯同步有交易。
5. **R-08 / R-11**(雙寫與擴展性)—— 移除假訂單、批次 API。
6. 其餘依模塊維護時順手處理。

## 更新規則

- 風險被處理掉時,把該項移到本文最後的「已處理」區(或直接刪除並在 git commit 說明),
  同時更新對應模塊文檔的「後續待辦」。
- 新發現的風險依嚴重度插入總表並補一節,編號延續遞增,不重用舊編號。
