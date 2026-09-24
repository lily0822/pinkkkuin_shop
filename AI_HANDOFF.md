# AI Handoff — Pinkkkuin Staging

## Current baseline

- Branch: `official-next`.
- Feature commit: `a7da542` (出貨申請展開式卡片、一鍵批次編輯連結、移除舊「送出 LINE 下單通知」按鈕、LINE 通知文案設定移至右上角 modal).
- Storefront/shared backend Staging: `https://pinkkkuin-staging.vercel.app` → `dpl_BXjaoPXQtB7CnX75zErZP1ckYGPB`.
- Backend source commit: `ef3010c`, pushed to `backend-staging` and referenced by `official-next`.
- Community frontend feature commit: `acffd3d`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_AnTJSo68yt3fu5A5RS1cDfEnjxc6`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Community LINE notifications (v1 — manual admin batch send)

- **Not automatic.** An earlier version of this round fired notifications automatically on status change (bought/arrived/marketplace-link-set); that was explicitly reverted. The 3 routes it touched (`order-items/[id]` PATCH, `notebooks` PATCH, `shipment-requests/[id]` PATCH) are back to exactly their pre-notification behavior.
- General batch flow (訂單明細): admin checks order rows (same checkboxes the batch status-update feature uses), picks a type from "LINE 通知類型" — now only **通知付款 / 到貨提醒** (賣貨便可下單 was removed from here, see below) — clicks "LINE 通知". Only the customers behind the checked rows are notified.
- `POST /api/backend/community/line-notifications` — body `{ orderIds, kind }`, `kind` validated against `COMMUNITY_LINE_BATCH_NOTIFICATION_KINDS = ['bought','arrived']` — looks up each order's nickname, dispatches via `src/lib/line/community-notifications.ts::sendCommunityOrderNotifications`, returns per-order results + `successCount`/`failedCount` for the toast.
- **Deduped by recipient**: `sendCommunityOrderNotifications` resolves every selected order to its bound LINE user id first, groups by that id, and sends exactly one LINE message per distinct recipient — a buyer with multiple selected orders gets one message, not one per order. Each order in the group still gets its own `community_line_notifications` row and its own entry in the returned results (same outcome as the one send), so status is still visible per selected order.
- **賣貨便可下單 moved to a dedicated per-出貨申請 action**: each card in the 出貨申請 list gets a "發送賣貨便通知" button, shown only when that card already has a `marketplace_url` — the admin never types a link in here. Click → `POST /api/backend/community/shipment-requests/[id]/notify` (empty body) → `sendCommunityShipmentMarketplaceNotification(shipmentRequestId)` reads nickname/order_ids/marketplace_url **fresh from the DB at send time** (so it always reflects whatever was last saved via the 賣貨便連結 input, single or batch, never a stale client value), builds `{{商品清單}}` from its own `order_ids`, sends, and records with `target_id` = the **shipment request id** (not an order id, since this trigger is scoped to one shipment request which may cover several orders for the same customer). The old "送出 LINE 下單通知" button (a manual completion marker that predated real LINE sending — just a confirm() + status→`completed`) has been **removed**; the status dropdown on each card already covers marking a request completed.
- **賣貨便連結 editing — single and batch, no popup**: the 出貨申請 card's 賣貨便連結 field shows a text input pre-filled with the current `marketplaceUrl` + a 保存 button, for any card not `completed`/`cancelled` (those keep the old read-only "開啟連結" display). Single-row 保存 client-validates HTTPS, then calls `updateCommunityShipmentStatus` (same PATCH endpoint, same pending→accepted auto-transition as before). A new "一鍵編輯連結" button (top-right of the 出貨申請 section, enabled once ≥1 card is checked) opens a modal that groups the checked requests **by buyer (nickname)** — one buyer with several requests/notebooks/products gets exactly one link input, showing their combined 包含記事本 + 商品明細 for context. One 保存 in that modal fires all the underlying PATCH calls together (`Promise.all`, admin doesn't wait row by row), then the card list reloads so every affected card's inline input shows the new value immediately. Batch save reuses the same single-request PATCH endpoint and pending→accepted transition — no new API, no migration. `editCommunityShipmentMarketplace`/`window.prompt()` remain gone; there is no prompt/popup/new-window anywhere in `lily-backend.html`.
- Recipient resolution (both paths): `community_line_bindings` where `review_status = 'approved'`, matched by nickname.
- Send: `sendLineUserText` in `src/lib/line/client.ts` (same pattern as the existing `sendLineAdminText`/`sendLineUserFlex`), using `LINE_CHANNEL_ACCESS_TOKEN` (confirmed configured on Vercel Preview).
- Result tracking: every attempt (success or failure — no binding, no link, push disabled, provider error) upserts into `community_line_notifications` on `(kind, target_id)`. Admin sees it in the 社群訂單 tab's "LINE 通知紀錄" panel (type / nickname / status pill / error / time), backed by `GET /api/backend/community/line-notifications` (unchanged). Pill wording: `未通知` / **`已送出`** (LINE API 發送請求成功 — tooltip makes clear this is not a read receipt, no "已讀" wording anywhere) / `失敗` (tooltip points at the 失敗原因 column).
- Explicitly out of scope for v1 (per instructions): top-up, payment rejection, and meetup notifications.

### Editable message templates (no migration)

- `src/lib/line/community-notification-templates.ts` holds the 3 default templates verbatim as given, and reads/writes the admin-edited versions through `schedule_settings` (type=`community-line-notification-templates`, JSON in the `image` column) — the same generic-KV pattern `member-line-notifications` already uses. No new table.
- Both send paths fetch the current saved template and render it: `{{商品清單}}` becomes one `系列名稱｜商品名稱 ×數量` line per bought item (bought+arrived items for `kind='arrived'`) across the relevant orders (the recipient's group for 通知付款/到貨提醒; that shipment request's own `order_ids` for 賣貨便可下單), `{{社群訂單連結}}` becomes the fixed `https://pinkkkuin-community-orders.vercel.app`, `{{賣貨便連結}}` becomes that shipment request's own `marketplace_url` (賣貨便可下單 only — never user-typed). Whatever the admin last saved is what goes out — "以當下儲存的模板為準".
- Admin UI: moved off the page body into a green "LINE 通知文案設定" button in the 社群訂單 section's top-right toolbar (matches the LINE brand color, next to the other section-level actions). Click opens a modal listing the 3 types, each with 編輯訊息 opening the same per-type editor modal as before — textarea, 3 insert-variable buttons, 恢復預設文案 (fills the textarea from the default, not saved until 儲存), 儲存 → `POST /api/backend/community/line-notification-templates`. Only the entry point moved; the list markup (`#community-line-template-list`), the per-type editor, and the API are unchanged.
- Batch send, LINE-user-id dedupe, and `community_line_notifications` logging are untouched by this round — only the message-content step changed.

### Blocked: migration not yet applied

- `supabase/migrations/202609230002_community_line_notifications.sql` creates `community_line_notifications` (kind, target_id, nickname, line_user_id, status, error_message, sent_at; unique on `(kind, target_id)`; `service_role` gets select/insert/update only, no delete). This has **not** been run against any database yet — needs to be applied manually in the Staging SQL Editor. No further migration was needed for the manual-send rework — same table, `target_id` just always means "order id" now at the application level.
- Until it's applied, clicking "LINE 通知" still won't error (the write to the log table is caught and logged like any other notification failure), but the 通知紀錄 panel will stay empty and re-clicking won't dedupe via the unique constraint.
- Not yet end-to-end tested (migration pending, and no Staging nickname with an approved LINE binding was available this round). Once the migration is applied: pick a customer with an approved LINE binding, (a) check their order row(s) in 訂單明細 (try selecting 2+ orders for the same customer to confirm the dedupe — only one LINE message should arrive) and send 通知付款/到貨提醒, (b) find/create a 出貨申請 for them with a marketplace_url set and click 發送賣貨便通知 — confirm the button doesn't appear at all when there's no link yet. For both: confirm their LINE received it (check the rendered {{商品清單}}/{{社群訂單連結}}/{{賣貨便連結}} look right) and the 通知紀錄 panel shows 已送出. Also try 編輯訊息 → change a template → send again → confirm the edited text (not the default) is what arrives.

## Current community admin UI

- Shipment request customer cells show only the LINE display name and bound community nickname.
- The main community order table is titled `訂單明細`; duplicate `搶購狀態` and `商品到貨` columns are removed.
- Notes remain text inputs and visually align with adjacent status controls.
- Notebook management is an accordion keyed by notebook name. Expanded rows show LINE name, nickname, product, variant, quantity, unit price, total, purchase status, and arrival status.
- Notebook management and the order table edit the same purchase/arrival data (both read the single `communityOrders` array and both re-render on every `loadCommunityOrders`) and refresh together. `renderCommunityNotebooks()` now preserves which notebook `<details>` was expanded across re-renders (tracked via `data-notebook-name`) — previously every refresh (整本設為已到貨 included) silently collapsed all accordions even though the underlying data was already fresh, which looked like it needed a manual refresh. Pure render-state fix, no data/flow change.
- Editable status controls render as black-text pills. Purchase, payment, and arrival colors follow the current approved mapping.
- Orders are grouped by the notebook's first source occurrence and keep the existing import/source row order using existing timestamps and IDs.
- 社群訂單 tab: 手動新增 modal (reuses the Excel-import RPC with a single row, so status columns take the same DB defaults); batch status update card (separate from the search/filter card, sits directly above the order table); a "LINE 通知" batch control sits right below it (same row checkboxes, pick 通知付款/到貨提醒, send — see LINE notifications section above); 4 inline status dropdowns restyled to match the filter-row look; 操作 column with 編輯 (existing fields only — no real delete capability exists yet, was checked and reported, not built); page-wide centered table alignment except 記事本名稱/社群暱稱/下單商品; 待處理摘要 widget (待審核付款/需補款/待建立賣貨便/待面交確認, computed client-side from existing endpoints, no new API); green "LINE 通知文案設定" button in the section's top-right toolbar opening the template-list modal (per-type 編輯訊息 modal unchanged, see LINE notifications section above); LINE 通知紀錄 panel (read-only log of every send attempt); 出貨申請 is now an expandable card list (not a table) — see next bullet.
- 出貨申請 card list (visual/interaction modeled on the 記事本管理 accordion, but a custom div-based toggle instead of native `<details>` since the summary row needs its own interactive controls): each card's always-visible summary keeps every control the old table row had — 客人 (LINE display name + nickname), 申請時間, 包含記事本, 付款狀態, 到貨狀態, 目前狀態 dropdown, 賣貨便連結 (inline input+保存, or read-only link once completed/cancelled), 操作 (發送賣貨便通知 when a link is saved), plus a selection checkbox and a "商品明細" toggle. The old "送出 LINE 下單通知" completion-marker button is removed. Clicking 商品明細 expands a per-notebook breakdown (商品名稱 ×數量 only, grouped under each 記事本 the request includes) — intentionally minimal, no payment/technical info, meant for a future shipment-review pass; sourced from a new `notebookGroups` field the GET endpoint now returns (built via plain queries over `order_ids`/`community_orders`/`community_order_items`, no RPC/migration change). Which cards are expanded is preserved across re-renders (`data-request-id` + `.community-shipment-card-body.open`, same pattern as the notebook accordion fix). A "一鍵編輯連結" button (top-right, enabled once ≥1 card is checked) opens the batch link-editing modal described above.

## Current community frontend UI

- Desktop binding/action card aligns with the unpaid + paid main content width.
- General order cards are white without decorative borders; unpaid/paid section styling and status pills remain unchanged.
- Shipment and meetup pending labels appear before the corresponding notebook title.
- Payment amount is locked to the calculated total (customer only picks a bank and enters the last 5 digits); the amount is shown as a large standalone block, not an editable input.
- A reminder ("請確認匯款完成後再送出...") sits above each payment submit button.
- Status wording simplified to drop backend-review language ("待審核"→"確認中", "審核退回"→"請重新送出").
- 7-11 (`ShipmentRequestModal`) and 面交 (`MeetupRequestModal`) both show a clear success confirmation on submit instead of closing silently.
- A short "確認有買到→匯款→等待到貨→申請出貨／面交" process guide sits above the order list.
- Mobile layout was not refactored.

## Verification

- Root build: PASS on every round above. Backend inline JavaScript syntax: PASS.
- Deploying from the `community-orders` git worktree (`.tmp-community-desktop`) directly with `vercel deploy` fails/hangs with `Not authorized` — root-caused to the worktree's `.git` metadata, not the code. Workaround: `git archive <commit> | tar -x -C <clean temp dir>`, copy `.vercel/project.json` in, deploy from there.
- Multi-notebook payment, NT$20 discount, top-up/refund, fulfillment locks, cancellation unlock, history, safe deletion, and Excel import logic were not changed this round.
- Community route and shared backend login route load successfully from their aliases after every deploy above.

## Next round

- Confirm the `202609230002_community_line_notifications.sql` migration has been applied to Staging, then run the 3 live manual notification tests (see above) and record the result here.
- Real delete for `community_orders`/`community_order_items` still has no DB capability (checked twice now — no DELETE grant, no RPC). A migration (`202609220001_community_order_item_safe_delete.sql`'s `delete_community_order_item`) already exists for per-item delete; wiring a 刪除 button into the 社群訂單 admin table's 操作 column is still open.
- Frontend "Next round" items from before this round are believed done (see Community frontend UI above) — re-confirm against the actual list if anything was missed: simplify frontend status wording ✅, clearer success feedback ✅, short process guide ✅, pending-work summary on the backend ✅.
- Underpayment/overpayment flows intentionally not touched.

## Fixed deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `pinkkkuin-community-orders.vercel.app` belongs only to `community-orders`.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
