# 模塊:品牌管理與前台外觀設定

> 本文為既有模塊的回溯整理。

對應選單:運營管理 → 品牌管理。
主要程式:`lily-backend.html:2992-3386`(序列化)、`4720-5773`(介面與存檔)。

這是後台唯一一個**輸出目標是前台**的模塊:這裡設定的東西都由前台 Next.js 讀取後渲染。

## 需求

後台要能不動程式碼就改前台的:

- **品牌識別**:商店名稱(中/英)、LOGO(含圖庫、縮放、拖曳定位)、浮水印(透明度/大小/位置)、品牌文字圖。
- **首頁內容**:頂部公告、Banner 輪播、首頁區塊(開關/標題/排序/顯示數量)、導覽列(開關/排序)。
- **圖片素材**:商品預設圖、時程預設圖。
- **網站資訊**:Instagram / LINE / Email / 商店簡介 / favicon / OG 分享圖。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| 設定存哪? | **複用 `ScheduleSettings` 工作表當通用 KV 表**:`type` 當 key、`image` 欄位塞 JSON 字串當 value。理由:不用改 Apps Script 的 action、不用改 Supabase schema,加一種設定只要加一個 `type`。**代價很明確**:`image` 欄位名稱與內容完全不符,Sheet 上看起來像亂碼,無法用 SQL 查任一個設定欄位。 |
| 為什麼不開一張 `site_settings` 表? | 那需要同時動 Supabase migration(前台 repo)、Apps Script、後台三處。目前選擇了最省事的路。**這是已知技術債**,見後續待辦。 |
| 存檔顆粒度 | 品牌識別是**逐項儲存**(各自有「保存 LOGO / 保存水印 / 保存文字圖」按鈕);首頁內容是**整批儲存**(一個「儲存首頁設定」按鈕,`Promise.all` 併發送 4 個 `saveScheduleSetting`)。 |
| LOGO 圖庫 | commit `2097cf6` 移除了直接上傳、`725430d` 改成圖庫管理:先上傳進圖庫,再從圖庫選一張當作使用中的 LOGO。理由:方便換季換 LOGO 又保留舊檔。 |
| 舊圖清理 | LOGO 刪除採**延後清理**:累積到 `pendingBrandLogoDeletePublicIds`,存檔成功後才真的刪 Cloudinary,且會排除目前使用中的 `logoPublicId`。 |

## 定案(現況實作)

### 四個分頁

`switchAppearanceTab(tab)` 切換:

| 分頁 | 內容 |
| --- | --- |
| 品牌識別 | 商店名稱(中/英)、LOGO 圖庫與編輯器、水印設定、品牌文字圖 |
| 首頁內容 | 公告 / Banner / 導覽列(再分三個子分頁,`switchHomeAppearanceTab`)+ 首頁區塊 |
| 圖片素材 | 商品預設圖、擺攤/連線預設圖 |
| 網站資訊 | IG / LINE / Email / 簡介 / favicon / OG 圖 |

### 設定 key 與內容

| `ScheduleSettings.type` | value 形式 | 對應狀態變數 |
| --- | --- | --- |
| `brand` | JSON | `brandSettings`(storeName / storeNameEn / logo / logoPublicId) |
| `brand-logo-library` | JSON 陣列 | `brandLogoImages` |
| `brand-logo` | URL 字串 | 舊格式,向下相容 |
| `brand-logo-scale` | 數字字串 50–200 | `brandSettings.logoScale` |
| `brand-watermark` | JSON | url / publicId / opacity / size / position |
| `brand-text-image` | JSON | textImage / textImagePublicId |
| `site-info` | JSON | `siteInfoSettings` |
| `site-announcements` | JSON 陣列 | `siteAnnouncements` |
| `site-banners` | JSON 陣列 | `siteBanners` |
| `homepage-sections` | JSON 陣列 | `homepageSections` |
| `site-navigation` | JSON 陣列 | `siteNavigation` |
| `stall` / `connection` | URL 字串 | `scheduleDefaultImages` |
| `product-default` / `product-default-scale` | URL / 數字字串 | `scheduleDefaultImages` |

每個 key 都有一組 `parseXxx()` / `xxxPayload()` 函式負責反序列化與序列化,
集中在 `lily-backend.html:2992-3302`。讀取端在 `applyBackendData()` 的
`data.scheduleSettings.forEach` 用一長串 `else if` 分派(`lily-backend.html:2178-2213`)。

### 預設值

程式碼內建的預設值(後端沒資料時使用):

- 商店名稱:`小企鵝選物` / `KOPENGUIN SELECT SHOP`
- LOGO:`https://res.cloudinary.com/dhrfwtarc/image/upload/v1782899951/pinkkkuin_logo_q1y5jr.png`
- 水印:透明度 70%、大小 45%、位置 `bottom-right`
- 導覽列 8 項:首頁(鎖定不可停用)/ 全部商品 / 預購商品 / 現貨 / 連線·擺攤 / 購物須知 / FAQ / 聯絡小企鵝
- 首頁區塊 5 個:分類捷徑(最多 8)/ 最新上架 / 現貨商品 / 預購商品(各 6)/ 購物流程(5)
- 社群:IG `pinkkkuin.jp`、LINE `@pinkkkuin`

### LOGO 編輯器

`openBrandLogoEditor()` 提供在框內拖曳定位 + 縮放(50–200%),
以 `brandLogoTransformStyle()` 產生 CSS transform。滑鼠與觸控事件都支援
(`startBrandLogoEditorDrag` / `moveBrandLogoEditorDrag` / `endBrandLogoEditorDrag`,
在 `DOMContentLoaded` 綁定)。

### 導覽列與排序

導覽列用 SortableJS 拖曳(`initSiteNavigationSortable`),
`首頁` 項目 `locked: true` 不可停用。也提供上下移動按鈕(`moveSiteNavigationItem`)。

### 存檔差異

```js
// 品牌識別:逐項
saveBrandSetting('logo')      // 連續 4 次 saveScheduleSetting:brand-logo / brand / brand-logo-library / brand-logo-scale
saveBrandSetting('watermark') // 1 次
saveBrandSetting('textImage') // 1 次

// 首頁內容:整批(Promise.all 4 個)
saveHomepageAppearanceSettings()

// 網站資訊
saveSiteInfoSettings()        // 1 次
```

`saveBrandSetting('logo')` 是**序列的 4 次 API 呼叫**,中途失敗會讓幾個 key 已更新、
幾個還沒,產生不一致狀態。

## 資料源與呼叫關係

```
品牌管理頁
  ├─ 讀:loadData() → readSupabaseScheduleSettings()(fallback: ScheduleSettings 工作表)
  │        → applyBackendData() 的 else-if 鏈依 type 分派給各 parse 函式
  ├─ 寫:fetchAPI('saveScheduleSetting', {id, type, image: JSON字串})
  ├─ 圖:POST/DELETE {前台}/api/upload → Cloudinary
  └─ 快取:localStorage pinkkkuin_brand_settings / pinkkkuin_schedule_default_images

前台 Next.js ── 讀 Supabase schedule_settings ──► 渲染 LOGO / 公告 / Banner / 導覽列 / 首頁區塊
```

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-15](risk-review.md#r-15) `S3` `schedule_settings` 被當通用 KV 表,應收斂為正式的 `site_settings`。
- [ ] [R-18](risk-review.md#r-18) `S3` `saveBrandSetting('logo')` 的 4 次序列呼叫中途失敗會不一致。
- [ ] [R-20](risk-review.md#r-20) `S3` 首頁內容未儲存變更離開頁面不攔截。

一般待辦:

- [ ] `applyBackendData()` 裡的 15 段 `else if` 應改成 `type → handler` 的對照表。
- [ ] 沒有任何「前台預覽」機制,存檔後只能開前台看結果。
