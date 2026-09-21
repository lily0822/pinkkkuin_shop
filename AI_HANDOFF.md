# AI Handoff — 社群訂單

## 基準
- Branch：`community-orders`
- 最新狀態：LINE 會員登入與社群暱稱綁定已實作，實際 HEAD 請以 `git log -1` 為準。
- Community alias：https://pinkkkuin-community-orders.vercel.app
- Git Preview：https://pinkkkuin-shop-git-community-orders-lilys-projects-2a8e834c.vercel.app
- Root `/` 是獨立社群訂單頁，沒有商城 header/footer/cart。
- Production 未動，不可自動部署。
- `pinkkkuin-staging.vercel.app` 永遠屬於 `official-next` 購物網站；`community-orders` 不得更新該 alias。

## 目前有效功能
- LINE Login 共用既有 channel credentials，但社群固定使用 `https://pinkkkuin-community-orders.vercel.app/api/community/line/callback`；商城仍使用 `/api/member/line/callback`，兩套 redirect/token exchange 分開。
- 首次登入：LINE 授權後輸入社群暱稱並綁定。
- 再次登入：由簽章 HttpOnly cookie 辨識 LINE 使用者，自動載入已綁定暱稱的訂單。
- 可更換綁定暱稱；新暱稱必須存在於社群訂單，且一個暱稱只能綁定一個 LINE 使用者。
- 社群訂單查詢、匯款回報、出貨申請 API 都從 LINE session 取得綁定暱稱，不再信任前端傳入的 nickname。
- 暱稱查詢結果、Mobile 卡片／Desktop 表格、狀態 badge、全選、匯款、出貨申請與到貨阻擋維持既有行為。
- 後台 `/backend` 社群管理、Excel 預覽／匯入、匯款與出貨管理維持既有行為。

## Migration
Staging 已執行：
- `202609180001_community_orders_schema.sql`
- `202609180002_community_orders_rpc.sql`
- `202609180003_community_order_items_variant_spec.sql`
- `202609180004_community_remittance_submissions.sql`
- `202609180005_community_shipment_requests.sql`

Staging 亦已執行：
- `202609210001_community_line_bindings.sql`

該 migration 只新增 `public.community_line_bindings`，RLS 開啟；anon/authenticated 無權限，service_role 只有 SELECT/INSERT/UPDATE，沒有 DELETE。Production 不可執行。

## 驗證
- `npm run build`：PASS
- 未登入 `/api/community/line/session`：200、`authenticated=false`
- 未登入 `/api/community/orders`：401
- 社群 OAuth invalid-state callback 分流：PASS
- 375 / 1440px：無 horizontal overflow
- 真實 LINE OAuth callback、首次綁定、自動載入、更換綁定：需由真人 LINE 帳號在 Community alias 完成最終驗收。

## 下一步
1. 在 Community alias 用真人 LINE 完成：首次登入 → 回到社群訂單頁 → 綁定測試暱稱 → 重新開啟自動載入 → 更換為另一個存在的測試暱稱。
2. 驗收後更新本檔結果；不要觸碰 official-next Staging alias 或 Production。

## 注意
- `.backend-product-publish` 是獨立 backend repo，本輪未修改。
- 本機 `.env.local` 的 `DATABASE_URL` 為空，不能用 direct DB 套 migration。
- 不要修改 `official-next`，不要碰商城會員／購物車／payment／logistics business logic。
