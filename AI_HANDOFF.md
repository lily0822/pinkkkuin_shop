# AI Handoff — 社群訂單 (Community Orders)

## 目前 branch
- `community-orders`（從 `official-next` 分出）
- Root `/` 直接顯示社群訂單查詢頁，無商城 header/footer/cart（layout 已精簡）

## 最新 commit
- `4331082e24ee2d31b55d8e795d7c51dbbdb9b1aa`

## Preview URL
- https://pinkkkuin-shop-git-community-orders-lilys-projects-2a8e834c.vercel.app
- 跟著 push 到 `community-orders` 自動更新，不用手動 `vercel alias`

## 目前已完成
- 客人暱稱查詢（Mobile 卡片 / Desktop 表格，含搶購／匯款／到貨／下單狀態 badge）
- Mobile 底部固定操作列（全選／勾選系列匯款總金額／我要匯款／我想出貨）
- 我要匯款：銀行下拉／後五碼／金額（可改，金額與系統不符會二次確認），後台可查
- 我想出貨：到貨檢查擋住未到貨系列 → 出貨申請表（收件人／手機／取貨門市，含防重複送出）
- 後台 `/backend`「社群管理」分頁：搜尋、Excel 匯入（先預覽再確認寫入）、匯入紀錄、匯款回報列表、出貨申請列表（可改狀態、可看商品內容）
- LINE 綁定會員入口先保留（目前是 disabled 佔位按鈕，未實作登入）

## 修改檔案
- `src/app/layout.tsx`、`src/app/page.tsx`
- `src/components/community-orders-client.tsx`（前台主要元件）
- `src/app/api/community/{orders,remittances,shipment-requests}/route.ts`
- `src/app/api/backend/community/{orders,order-items/[id],import,import-batches,remittances,shipment-requests,shipment-requests/[id]}/route.ts`
- `.backend-product-publish/lily-backend.html`（submodule，社群管理分頁 UI）

## DB / migration 進度
已新增（`supabase/migrations/`）：
- `202609180001_community_orders_schema.sql`
- `202609180002_community_orders_rpc.sql`
- `202609180003_community_order_items_variant_spec.sql`
- `202609180004_community_remittance_submissions.sql`
- `202609180005_community_shipment_requests.sql`

已執行到 Staging Supabase：以上 5 個全部（使用者已在 SQL editor 手動跑完並確認成功）。
尚未執行：無。

## 驗收結果
以真實 Staging DB 完整跑過（非 mock）：
- 查詢／Mobile 卡片／Desktop 表格：PASS
- 我要匯款送出＋後台可見：PASS
- 我想出貨到貨檢查（阻擋未到貨系列）：PASS
- 出貨申請送出＋後台可見＋狀態可改：PASS
- 320 / 375 / 390 / 430px 無 horizontal overflow：PASS
- Desktop 無 regression：PASS
- Build：PASS

## Production
- 全程未動。`pinkkkuin-shop.vercel.app` production alias 未變更。

## 不能破壞的既有功能
- 現有購物車／商品／會員／payment／logistics business logic
- `official-next` branch 不得修改
- Production 不得部署或更動

## 下一步
1. LINE 會員綁定登入（目前只是 disabled 佔位按鈕）
2. 取貨門市真正串接（這輪只有純文字輸入，未接超商門市選擇器）
3. 決定何時／是否把 `community-orders` 功能併回 `official-next` 或正式上線

## submodule / env / 特殊注意事項
- `.backend-product-publish` 是 git submodule，指向獨立 repo `github.com/lily0822/workspace.git` 的 `backend-staging` branch。修改後台 HTML 時：進該資料夾、在 detached HEAD 上 commit、`git push origin HEAD:backend-staging`，再回父repo `git add .backend-product-publish` 更新 gitlink 並隨父repo一起 commit。
- 該 submodule 資料夾內有一條**未使用、已 diverge 的本地 `backend-staging` branch**（未 push，含舊 commit `4fd3b52`），內容較舊且會回退新功能，不要 checkout 或 merge 它，一律在 detached HEAD 工作。
- 本機 `.env.local` 直接連 Staging Supabase；且本機因未設 `BACKEND_SESSION_SECRET`，`/backend` 會跳過登入驗證，方便本機測試，但與真正 Staging 環境需要登入不同，勿混淆。
- `community_*` 系列資料表 service_role 只有 `SELECT/INSERT/UPDATE`，刻意不給 `DELETE`（最小權限）。Staging 裡會留測試資料（如 `acceptance_test_001`、`acceptance_test_002` 開頭的暱稱），這是預期行為，不用清除。
