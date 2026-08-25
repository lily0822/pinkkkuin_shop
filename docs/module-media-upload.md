# 模塊:圖片上傳與 Cloudinary 管理

> 本文為既有模塊的回溯整理。

主要程式:`lily-backend.html:2026`(端點設定)、`3387-3677`(圖片編輯器與上傳)、
`4757-4855`(品牌素材)、`5385-5757`(Banner / favicon / OG)。

## 需求

- 後台要能上傳商品圖、品牌 LOGO、水印、文字圖、Banner、favicon、OG 圖。
- 圖片要有穩定 CDN、要能刪除、要能在前台直接用。
- 後台是靜態頁面,不能持有 Cloudinary API secret。

## 選項與取捨

| 選項 | 取捨 |
| --- | --- |
| 圖片轉 base64 存進 Sheet / Supabase | 資料量爆炸、Sheet 單格有長度上限。**明確禁止**,`normalizeProductImageUrl()` 會直接丟棄 `data:` URL。 |
| 只允許本機 `/images/xxx` 相對路徑 | 早期作法(commit `6d32b93 Restrict product images to local files`),需要手動把檔案放進前台 repo,營運端無法自助。**已淘汰**。 |
| Cloudflare R2 | 曾實作(commit `1fcb871 Add R2 product image management`),後改用 Cloudinary。**已淘汰**。 |
| **前端 → 前台 Next.js `/api/upload` → Cloudinary** | secret 收在 Vercel env,後台只需要打一個 HTTP 端點。**採用**(commit `923c7d6` / `4810708`)。 |

歷史演進:本機檔案 → R2 → Cloudinary(直傳)→ Cloudinary(經前台 API)。
`normalizeProductImageUrl()` 仍保留 `/images/` 相對路徑的正規化邏輯,是為了向下相容舊資料。

## 定案(現況實作)

### 端點

```js
const PRODUCT_UPLOAD_API_URL = window.PINKKKUIN_UPLOAD_API_URL
  || (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)
        ? 'http://127.0.0.1:3000/api/upload'
        : 'https://pinkkkuin-shop.vercel.app/api/upload');
```

**注意:非 localhost 時一律指向 Production 前台的上傳端點**,包含 staging 後台。
所以 staging 上傳的測試圖會進到與正式站相同的 Cloudinary 空間。

| 動作 | 方法 | 內容 |
| --- | --- | --- |
| 上傳 | `POST` | `FormData`:`productId` + 多個 `files` |
| 刪除 | `DELETE` | JSON `{publicIds: [...]}` |

上傳回應預期為 `{images: [{secure_url, public_id}, ...]}`。

### 商品圖編輯器

每個編輯中的商品有一份獨立 store(`productImageEditStores[type:id]`):

```js
{
  images: [],              // 已存在的圖(有 publicId)
  pendingFiles: [],        // 尚未上傳的本機檔案(含 objectURL 預覽)
  deletedPublicIds: [],    // 使用者在編輯期間移除、待存檔時真正刪除的
  lastUploadedPublicIds: []// 本次上傳的,存檔失敗時用來回收
}
```

流程:

1. 拖曳 / 選檔 → `handleProductImageFiles()` 進 `pendingFiles`,只做本機預覽,不上傳。
2. 按存檔 → `uploadPendingProductImages()` 一次上傳所有 `pendingFiles`,合併進 `images`。
3. `normalizePrimaryProductImages()` 保證恰有一張主圖、`sortOrder` 連號。
4. 呼叫 `saveStockProduct` / `savePreorderProduct` 寫回後端。
5. 存檔**失敗**時 `cleanupUploadedProductImages(lastUploadedPublicIds)` 把剛上傳的圖刪掉,避免孤兒檔。
6. 刪除商品時 `deleteCloudinaryImages(cloudinaryPublicIdsFromProduct(product))` 一併清 Cloudinary。

主圖 / 排序操作:`setProductPrimaryImage()`、`moveProductImage()`、`removeProductImage()`。

### 其他素材

| 素材 | 上傳函式 | 存放 `schedule_settings.type` |
| --- | --- | --- |
| 品牌 LOGO | `handleBrandLogoFiles()` | `brand` / `brand-logo-library` |
| 水印 | `handleBrandAssetFile('watermark')` | `brand-watermark` |
| 品牌文字圖 | `handleBrandAssetFile('textImage')` | `brand-text-image` |
| 首頁 Banner | `handleSiteBannerImageFile()` | `site-banners` |
| favicon / OG 圖 | `handleSiteInfoAssetFile()` | `site-info` |

刪除素材時同樣走 `deleteCloudinaryImages()`。
LOGO 圖庫的刪除是延後執行的:先累積到 `pendingBrandLogoDeletePublicIds`,存檔成功後才真正刪。

### Cloudinary folder 慣例

`products/`、`site/logo/`、`site/banners/`、`site/watermark/`、
`site/brand-text/`、`site/favicon/`、`site/og/`。

## 資料源與呼叫關係

```
後台前端
  ├─ POST   {前台}/api/upload  ──► Cloudinary(前台持 API secret)
  ├─ DELETE {前台}/api/upload  ──► Cloudinary
  └─ POST   Apps Script ──► Sheet + Supabase(只存 URL 與 publicId,不存二進位)
```

Apps Script 端不碰 Cloudinary。`syncSupabaseProductImages()` **只寫入有 `publicId` 的圖片**,
純 URL(例如舊的 `/images/xxx`)在鏡像到 Supabase 時會被丟掉。

## 後續待辦

風險項(嚴重度與處置細節見 [risk-review.md](risk-review.md)):

- [ ] [R-10](risk-review.md#r-10) `S2` Cloudinary 未拆 staging / production,staging 上傳端點固定指向正式前台。
- [ ] [R-21](risk-review.md#r-21) `S3` 鏡像失敗時產生 Cloudinary 孤兒檔;刪除未分批。
- [ ] [R-30](risk-review.md#r-30) `S4` 沒有前端的檔案大小 / 類型檢核,上傳失敗也沒有重試。
