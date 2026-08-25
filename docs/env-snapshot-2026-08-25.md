# 環境 / 部署 / 資料庫盤點快照(2026-08-25)

> 這是 2026-08-25 的**原始盤點紀錄**,保留備查、不再更新。
> 重點已整理進 [architecture.md](architecture.md)、[environments.md](environments.md)、
> [data-model.md](data-model.md),日常請以那三份為準。

---


## 版本控管
已完成推送與 release 分支建立，沒有 deploy Production、沒有動 AITEST。
前台 repo：
https://github.com/lily0822/pinkkkuin_shop.git
Branch：official-next
最新 commit：12686f0 Add staging backend and variant cart support
Push：成功
Release branch：release/2026-08-25
Release branch push：成功
目前 git status：clean
後台 repo：
https://github.com/lily0822/workspace.git
Branch：main
最新 commit：a6eb682 Support local staging backend override
後台本來沒有未提交變更，所以沒有新增 commit
Release branch：release/2026-08-25
Release branch push：成功
目前 git status：clean
Build / safety：
前台 npm run build：PASS
secret scan：PASS，沒有發現 key / secret / .env 被提交
.backend-product-publish 沒有被包進前台 repo
Production 沒有部署或修改。


## 資料保存/環境部屬
以下是目前「開發 / staging / production」所有會保存資料或部署程式的位置，不含任何 key / secret 值。
正式專案
唯一正式工作目錄：
C:\Users\lily.deng\Desktop\pinkkkuin_shop
AITEST 目前定位：
C:\Users\lily.deng\Desktop\AITEST
→ legacy 備份，不再開發 / 部署 / 當 source。
前台部署
Production 前台：
https://pinkkkuin-shop.vercel.app
部署平台：Vercel
Vercel project：pinkkkuin-shop
Git repo：https://github.com/lily0822/pinkkkuin_shop.git
主要 branch：official-next
release branch：release/2026-08-25
使用 Production env
使用 Production Supabase
Staging 前台：
https://pinkkkuin-staging.vercel.app
部署平台：Vercel Preview deployment + fixed alias
Git repo 同上
使用 Preview env
使用 pinkkkuin-staging Supabase
顯示 STAGING badge
本機前台：
http://127.0.0.1:3000
來源：C:\Users\lily.deng\Desktop\pinkkkuin_shop
使用 .env.local
目前應指向 staging Supabase
後台部署
Production 後台：
https://lily0822.github.io/workspace/lily-backend.html
部署平台：GitHub Pages
後台 repo：https://github.com/lily0822/workspace.git
branch：main
release branch：release/2026-08-25
本機來源：
C:\Users\lily.deng\Desktop\pinkkkuin_shop.backend-product-publish
HTML：lily-backend.html
Apps Script：Production Apps Script Web App
使用 Production Supabase + Production Google Sheet
Staging 後台：
https://pinkkkuin-staging.vercel.app/backend
部署平台：Vercel Preview /backend route
來源仍是：
.backend-product-publish/lily-backend.html
API target 由 Vercel Preview env：
STAGING_BACKEND_API_URL
使用 staging Apps Script Web App
使用 staging Google Sheet
使用 pinkkkuin-staging Supabase
顯示 STAGING badge
本機後台：
通常可用本機 HTTP server 開：
http://127.0.0.1:xxxx/lily-backend.html
來源：
C:\Users\lily.deng\Desktop\pinkkkuin_shop.backend-product-publish\lily-backend.html
使用 ignored 檔案：
.backend-product-publish/backend-env.local.js
指向 staging Apps Script
不應 fallback 到 production
資料庫 / 資料保存
Production Supabase：
用途：正式商品、分類、IP、商品類別、商品圖片、variants、外觀設定
tables 主要包含：
products
product_images
product_variants
categories
product_categories
schedule_settings
orders
order_items
vendors
websites
backend_orders
stall_schedules
connection_schedules
Staging Supabase：
project：pinkkkuin-staging
用途：localhost / staging Preview / staging backend 測試資料
schema 已套 migration
TEST 商品、TEST IP、TEST 類別只能寫這裡
Google Sheet：
Production Google Sheet：Production Apps Script 使用
Staging Google Sheet：staging Apps Script 使用
Apps Script 讀寫後會同步 Supabase
本機不應直接寫 Production Sheet
Cloudinary：
目前 Production / Staging 仍共用 Cloudinary 帳號
用途：商品圖片
Logo
Banner
watermark
favicon
OG image

folder 大致：
products/
site/logo/
site/banners/
site/watermark/
site/brand-text/
site/favicon/
site/og/
注意：Cloudinary 目前尚未完全拆 staging / production，所以 staging 測圖仍有可能進同一個 Cloudinary 空間。
瀏覽器本機保存
前台購物車：
儲存在 browser localStorage
key：pinkkkuin_cart_items
不寫 Supabase，目前還不是正式訂單
後台暫存 / cache：
後台 HTML 有使用 localStorage 快取商品、標籤、設定等
主要只是瀏覽器端暫存，不是正式資料來源
環境變數保存位置
本機：
.env不應再保存 Production Supabase credentials
可保存非 Supabase 的本機設定

.env.locallocalhost staging 設定
git ignored

.backend-product-publish/backend-env.local.js本機 staging backend override
git ignored

Vercel：
Production envProduction Supabase
Cloudinary
UPLOAD_ALLOWED_ORIGIN

Preview envstaging Supabase
APP_ENV=staging
SUPABASE_ENV=staging
STAGING_BACKEND_API_URL

Apps Script：
Production Script PropertiesProduction Supabase URL
Production service role key

Staging Script Propertiesstaging Supabase URL
staging service role key

Git 保存位置
前台：
https://github.com/lily0822/pinkkkuin_shop.git
active：official-next
release：release/2026-08-25
後台：
https://github.com/lily0822/workspace.git
active：main
release：release/2026-08-25
目前一句話總結
開發 / staging 都應該走：
pinkkkuin_shop → Vercel Preview / localhost → staging Apps Script → staging Google Sheet → pinkkkuin-staging Supabase
正式 production 走：
pinkkkuin_shop official-next → Vercel Production → Production Supabase
正式後台走：
GitHub Pages workspace → Production Apps Script → Production Google Sheet / Production Supabase