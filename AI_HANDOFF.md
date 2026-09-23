# AI Handoff — Pinkkkuin Staging

## Current baseline

- Branch: `official-next`.
- Feature commit: `991fd27` (`Replace automatic LINE triggers with manual admin batch send`).
- Storefront/shared backend Staging: `https://pinkkkuin-staging.vercel.app` → `dpl_8QyVrfBoJ8z9kaoSgdXKrQ49Facy`.
- Backend source commit: `010b6f2`, pushed to `backend-staging` and referenced by `official-next`.
- Community frontend feature commit: `acffd3d`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_AnTJSo68yt3fu5A5RS1cDfEnjxc6`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Community LINE notifications (v1 — manual admin batch send)

- **Not automatic.** An earlier version of this round fired notifications automatically on status change (bought/arrived/marketplace-link-set); that was explicitly reverted. The 3 routes it touched (`order-items/[id]` PATCH, `notebooks` PATCH, `shipment-requests/[id]` PATCH) are back to exactly their pre-notification behavior.
- Current flow: in the 社群訂單 tab's `訂單明細` table, admin checks order rows (same checkboxes the batch status-update feature uses), picks a type from "LINE 通知類型" (通知付款 / 到貨提醒 / 賣貨便可下單), clicks "LINE 通知". Only the customers behind the checked rows are notified.
- `POST /api/backend/community/line-notifications` — body `{ orderIds, kind }` — looks up each order's nickname, sends one-by-one via `src/lib/line/community-notifications.ts::sendCommunityOrderNotifications`, returns per-order results + `successCount`/`failedCount` for the toast.
- Recipient resolution: `community_line_bindings` where `review_status = 'approved'`, matched by nickname. For `kind = 'marketplace_ready'`, the link is looked up from the order's most recent `community_shipment_requests` row (`order_ids` array contains the order id) with a non-null `marketplace_url`; no link found → recorded as `failed`, no send attempted.
- Send: `sendLineUserText` in `src/lib/line/client.ts` (same pattern as the existing `sendLineAdminText`/`sendLineUserFlex`), using `LINE_CHANNEL_ACCESS_TOKEN` (confirmed configured on Vercel Preview).
- Result tracking: every attempt (success or failure — no binding, no link, push disabled, provider error) upserts into `community_line_notifications` on `(kind, target_id)`, `target_id` = order id for all 3 kinds. Admin sees it in the 社群訂單 tab's "LINE 通知紀錄" panel (type / nickname / 未通知·已通知·失敗 pill / error / time), backed by `GET /api/backend/community/line-notifications` (unchanged from before).
- Explicitly out of scope for v1 (per instructions): top-up, payment rejection, and meetup notifications.

### Blocked: migration not yet applied

- `supabase/migrations/202609230002_community_line_notifications.sql` creates `community_line_notifications` (kind, target_id, nickname, line_user_id, status, error_message, sent_at; unique on `(kind, target_id)`; `service_role` gets select/insert/update only, no delete). This has **not** been run against any database yet — needs to be applied manually in the Staging SQL Editor. No further migration was needed for the manual-send rework — same table, `target_id` just always means "order id" now at the application level.
- Until it's applied, clicking "LINE 通知" still won't error (the write to the log table is caught and logged like any other notification failure), but the 通知紀錄 panel will stay empty and re-clicking won't dedupe via the unique constraint.
- Not yet end-to-end tested (migration pending, and no Staging nickname with an approved LINE binding was available this round). Once the migration is applied: pick a customer with an approved LINE binding, check their order row(s) in 訂單明細, send each of the 3 notification types, confirm their LINE received it and the 通知紀錄 panel shows 已通知.

## Current community admin UI

- Shipment request customer cells show only the LINE display name and bound community nickname.
- The main community order table is titled `訂單明細`; duplicate `搶購狀態` and `商品到貨` columns are removed.
- Notes remain text inputs and visually align with adjacent status controls.
- Notebook management is an accordion keyed by notebook name. Expanded rows show LINE name, nickname, product, variant, quantity, unit price, total, purchase status, and arrival status.
- Notebook management and the order table edit the same purchase/arrival data and refresh together.
- Editable status controls render as black-text pills. Purchase, payment, and arrival colors follow the current approved mapping.
- Orders are grouped by the notebook's first source occurrence and keep the existing import/source row order using existing timestamps and IDs.
- 社群訂單 tab: 手動新增 modal (reuses the Excel-import RPC with a single row, so status columns take the same DB defaults); batch status update card (separate from the search/filter card, sits directly above the order table); a "LINE 通知" batch control sits right below it (same row checkboxes, pick a type, send — see LINE notifications section above); 4 inline status dropdowns restyled to match the filter-row look; 操作 column with 編輯 (existing fields only — no real delete capability exists yet, was checked and reported, not built); page-wide centered table alignment except 記事本名稱/社群暱稱/下單商品; 待處理摘要 widget (待審核付款/需補款/待建立賣貨便/待面交確認, computed client-side from existing endpoints, no new API); LINE 通知紀錄 panel (read-only log of every send attempt).

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
