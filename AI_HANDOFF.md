# AI Handoff — official-next

## Current baseline

- Branch: `official-next`
- Storefront Staging: `https://pinkkkuin-staging.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`
- Community frontend: `https://pinkkkuin-community-orders.vercel.app`
- Production: `https://pinkkkuin-shop.vercel.app` — never deploy without explicit approval.

## Shared backend

- Backend source branch: `backend-staging` (in `workspace.git`, checked out detached at `.backend-product-publish`)
- Backend commit: `109148e`
- The local `backend-staging` branch inside `.backend-product-publish` has diverged and must not be checked out. Backend UI work is committed in detached HEAD and pushed with `git push origin HEAD:backend-staging`.
- `社群管理` contains `社群訂單` and `社群名單`; existing order/import/remittance/shipment flows remain unchanged.
- `社群名單` uses two standard tables. Approved bindings have separate LINE-name and nickname filters, nickname editing, and confirmed unbinding, plus 綁定時間 (`createdAt`) and 最後更新時間 (`updatedAt`) columns — both already existed on `community_line_bindings`, no migration.
- `已綁定名單` → 刪除 calls the existing `unbind` action (nulls nickname/requested_nickname, resets `review_status` to `not_requested`, keeps the row for the same `line_user_id`). `GET /api/backend/community/members`'s `pending` bucket now only includes rows with `review_status = 'pending'` AND a submitted `requestedNickname` (commit `ddffad2`), so an unbound row disappears from both lists instead of reappearing in 待處理名單 as an inert "未申請" placeholder — that placeholder display no longer happens for any row (including a genuine first-time LINE login that hasn't requested a nickname yet), since the two states are indistinguishable without a migration. Re-binding requires the front-end flow again.
- Pending bindings support row approval, select-all, and batch approval. Successful rows move to approved immediately; failed rows remain pending. Approval only depends on review state (`pending`) and nickname-conflict checks — it does not require the nickname to already have a community order (fixed in `src/app/api/backend/community/members/route.ts`, commit `80a6473`).
- `社群訂單` table has a checkbox column with select-all and a batch-update control (choose 匯款/到貨/下單/搶購狀態 and a target value, apply to all selected rows), now in its own card directly above the table (separate from the search/filter card). Order-level fields (匯款/到貨/下單狀態) dedupe by `orderId` before patching; 搶購狀態 patches each selected item individually. Requests reuse the existing single-row PATCH endpoints sequentially (no new API); success/fail counts are reported and partial failures are never rolled back.
- `社群訂單` table also has four status filter dropdowns (匯款/到貨/下單/搶購狀態, combinable with AND logic) that filter only the already-loaded page of rows client-side; no new API was added and it does not reach across pages.
- `社群訂單` toolbar has 手動新增 (opens a modal for notebook/nickname/product/spec/qty/price, reusing `/api/backend/community/import` POST with a single-row array — statuses fall back to the same DB defaults Excel import already relies on, no new API).
- `社群訂單` table's 4 inline status dropdowns use a new `.community-order-status-select` class (rounded/bordered/custom chevron, matches the filter-row look) instead of the shared `.storefront-order-status-select` (left alone — that class is also used by the unrelated 訂單管理 page).
- `社群訂單` table has an 操作 column with 編輯 and 刪除. 刪除 requires a confirmation, then calls the authenticated same-origin `DELETE /api/backend/community/orders`; the route validates the UUID and calls the Staging-only `delete_community_order(uuid)` SECURITY DEFINER RPC. Success reloads the table immediately. The RPC deletes only the selected order and its items.
- All tables on the `社群訂單` page (main order table, import-batch/remittance/shipment tables) default to centered headers/cells, except 記事本名稱/社群暱稱/下單商品 which stay left-aligned; scoped to `#section-community-orders` so other pages are unaffected.
- Backend module and submenu order can be changed from the top-right `調整模塊順序` modal.
- Module order is shared across administrators through the existing `schedule_settings` row with type `backend-module-order`; it is not stored in browser storage.

## Audit / LINE-timestamp architecture check (2026-09-21)

Checked only — not implemented, since it needs schema changes:

- 後台操作紀錄 (who/when/old→new value): not supported for `community_orders`, `community_order_items`, or `community_line_bindings`. The only existing audit table, `backend_security_audit_logs`, is schema-locked to member security actions (`action` CHECK limited to `member_pii_reveal`/`member_disable`/`member_reenable`; `target_user_id` is a FK to `auth.users(id)`, incompatible with these tables' ids). Reusing it needs a migration.
- LINE 綁定時間: already available — `community_line_bindings.created_at` is set once on first upsert (`line_user_id` conflict target) and not touched by later logins. No change needed.
- LINE 最後更新時間: already available — `community_line_bindings.updated_at` auto-updates on every login and every admin action (approve/edit/unbind), and is already returned by `GET /api/backend/community/members` as `updatedAt`. It conflates user- and admin-driven updates; there is no separate "admin last touched" column.
- 解除綁定紀錄: not supported. `unbind` nulls `nickname`/`requested_nickname`/`approved_at` and resets `review_status` in place with no history kept. Needs a new append-only table (or an extended audit log) via migration.

## Staging data

- Community migrations through `202609210003_community_orders_safe_delete.sql` are applied to Staging.
- `202609210003_community_orders_safe_delete.sql` has not been applied to Production.
- Migration files do not execute automatically in Production.

## Rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- Community frontend deployments must never update the Staging alias.
- Backend `main` and Production remain untouched unless explicitly approved.

## Submodule safety rule (`.backend-product-publish`)

- `git checkout <branch>` only updates the superproject's recorded submodule pointer; it does NOT update the submodule's actual checked-out files. `/backend` reads live from `.backend-product-publish` at build time, so a stale checkout silently ships the wrong backend UI.
- Before any build or deploy that touches `/backend`, verify these two match: (1) the commit this branch records (`git ls-tree HEAD .backend-product-publish`), (2) the submodule's actual HEAD (`git -C .backend-product-publish rev-parse HEAD`). If they differ, run `git submodule update --init .backend-product-publish` and re-verify before proceeding.
- Do not check out the local `backend-staging` branch inside `.backend-product-publish` — it has diverged from remote. Work in detached HEAD (what `git submodule update` leaves it in), commit there, then push with `git push origin HEAD:backend-staging`.
