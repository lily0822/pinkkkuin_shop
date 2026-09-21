# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`
- Community alias: `https://pinkkkuin-community-orders.vercel.app`
- Git branch Preview: `https://pinkkkuin-shop-git-community-orders-lilys-projects-2a8e834c.vercel.app`
- `pinkkkuin-staging.vercel.app` belongs only to `official-next`; never point community deployments at it.
- Production is untouched and must not be deployed without explicit approval.

## Current feature

Community LINE login and nickname review are separated from the storefront member flow:

- The community LINE callback returns only to the community page and preserves the LINE identity immediately.
- A nickname submission creates a pending review; it does not bind or query orders.
- Only an approved nickname can query community orders.
- `查詢訂單` is a separate action.
- An approved user can request a replacement nickname; the old approved nickname remains usable until approval.
- Backend `社群管理` is a top-level module with `社群訂單` and `社群名單`.
- `社群訂單` retains the existing import, order, remittance, and shipment functions.
- `社群名單` shows approved users and pending/unsubmitted LINE identities; pending applications can be approved.

## Staging migrations

Applied to Staging through:

- `202609180001_community_orders_schema.sql`
- `202609180002_community_orders_rpc.sql`
- `202609180003_community_order_items_variant_spec.sql`
- `202609180004_community_remittance_submissions.sql`
- `202609180005_community_shipment_requests.sql`
- `202609210001_community_line_bindings.sql`
- `202609210002_community_line_binding_reviews.sql`

The latest migration makes approved nickname and pending nickname separate, adds review status and approval time, preserves existing approved bindings, keeps RLS enabled, and grants only SELECT/INSERT/UPDATE to `service_role`.

## Validation

- Next.js production build: PASS
- Backend inline JavaScript syntax: PASS
- No DB/schema changes beyond the new additive Staging migration.
- Existing storefront `/member` LINE flow was not modified.
- Existing community order/import/remittance/shipment logic was not modified.

## Next step

Verify on the community alias with a real LINE account:

1. First LINE login appears in backend `社群名單` as `未申請`.
2. Submit a nickname and confirm `等待審核`; pending nickname cannot query.
3. Approve it in backend and confirm it moves to `已綁定名單`.
4. Reload the community page and use the separate `查詢訂單` button.
5. Submit a replacement nickname and confirm the previous approved nickname remains active until approval.
