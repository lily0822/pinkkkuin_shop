# 模塊:商品標籤管理(IP / 商品類別)

> 本文為既有模塊的回溯整理。

對應選單:商品管理 → 商品標籤管理。
主要程式:`lily-backend.html:2769-2801`、`3441-3497`、`4324-4606`。

## 需求

- 商品要能同時掛「IP」(角色/系列,例如某動畫 IP)與「商品類別」(吊飾、玩偶…)兩種標籤。
- 標籤要能設定顏色,在商品列表上以色塊顯示。
- 標籤要能停用(暫時不出現在前台)而非只能刪除。
- 標籤要能排序,順序會影響前台顯示。
- 支援一次新增多筆。

## 選項與取捨

| 議題 | 取捨 |
| --- | --- |
| IP 與類別分成兩張表? | **不分**。同一份 `ProductTags`,用 `type` 欄位區分 `ip` / `category`。Supabase 端同樣共用 `categories` 表。理由:兩者的欄位與操作完全相同。 |
| 儲存時機 | **延後儲存**。編輯、刪除、拖曳排序都只改本地狀態並標記 dirty,要按「儲存標籤設定」才整批寫回後端。理由:排序與批次編輯若即時寫入會產生大量 API 呼叫。代價是使用者可能忘記按儲存。 |
| 刪除行為 | 刪除時同步把該標籤從所有商品的 `tagIds` 移除,並把 id 累積到 `deletedProductTagIds`,儲存時才真正呼叫 `deleteProductTag`。 |
| 排序實作 | SortableJS 拖曳(`initProductTagSortable`),兩種 type 各一個 Sortable 實例。 |
| `type` 保存 | commit `220e479` 後,Apps Script 端 `syncSupabaseCategory()` 在 payload 沒帶 `type` 時會沿用資料庫既有值,避免同步時把 `ip` 洗成 `category`。 |

## 定案(現況實作)

### 資料結構

```js
{ id, name, type: 'ip' | 'category', enabled: true, sortOrder: 0,
  color: '#ec4899', createdAt, updatedAt }
```

`id` 新增時是 `${Date.now()}-${index}`(字串),與商品的純數字 id 不同格式。
所有比對一律用 `String()` 轉換後比較(`sameId`)。

### 介面

- 頁面分成 IP 與商品類別兩欄(`product-tag-column`),各自獨立拖曳排序。
- 新增/編輯用彈窗,**新增時可一次加多列**(`addProductTagEditRow`),編輯時只處理第一列。
- 顏色可用色票選擇器或直接填 HEX,兩者雙向同步(`syncProductTagColor` / `syncProductTagHex`)。

### 驗證規則(`saveProductTag`)

- 名稱不可空白。
- HEX 必須符合 `#RRGGBB`。
- 同一 `type` 內名稱不可重複(編輯時排除自己)。
- 同一批新增內部也不可重複。

### 顏色與可讀性

`normalizeHexColor()` / `hexToRgb()` / `readableTextColor()` 依亮度決定文字色:
亮度 > 0.72 時文字用深灰 `#334155`,否則用標籤色本身。標籤樣式由 `tagStyleVars()` 產生 CSS 變數。

### 刪除提示

`deleteProductTag()` 會先用 `productTagUsageCount(id)` 算出有幾件商品在用,
在確認對話框中告知,並提醒「按『儲存標籤設定』後才會正式刪除」。

### 儲存(`saveProductTagsSettings`)

```
for (id of deletedProductTagIds) → fetchAPI('deleteProductTag', null, id)
for (tag of normalizeProductTags(productTags)) → fetchAPI('saveProductTag', tag)
```

**全量逐筆寫回**,不做差異比對。標籤數量不多時可接受。

## 資料源與呼叫關係

```
標籤管理頁
  ├─ 讀:loadData() → readSupabaseCategories()(fallback: ProductTags 工作表)
  ├─ 寫:fetchAPI('saveProductTag' / 'deleteProductTag') → ProductTags 工作表 + categories 鏡像
  └─ 快取:localStorage pinkkkuin_product_tags
```

商品與標籤的關聯存在商品側的 `tagIds`,Apps Script 同步時展開成
`product_categories` 關聯表(先刪該商品全部關聯,再整批插入)。
`getOrCreateSupabaseCategoryByTagId()` 在關聯時發現 Supabase 沒有該標籤,
會回頭讀 `ProductTags` 工作表補建。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-11](risk-review.md#r-11) `S2` `saveProductTagsSettings` 全量逐筆寫回,API 呼叫數線性成長。
- [ ] [R-17](risk-review.md#r-17) `S3` 刪除標籤時沒有把受影響的商品寫回後端。
- [ ] [R-20](risk-review.md#r-20) `S3` 「未儲存」狀態只有一行文字提示,離開頁面不會攔截。
- [ ] [R-26](risk-review.md#r-26) `S4` 標籤 id 格式與商品 id 不一致。
