# AI Handoff — official-next

## Current baseline

- Branch: `official-next`
- Storefront Staging: `https://pinkkkuin-staging.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`
- Community frontend: `https://pinkkkuin-community-orders.vercel.app`
- Production: `https://pinkkkuin-shop.vercel.app` — never deploy without explicit approval.

## Shared backend

- Backend source branch: `backend-staging`
- Backend commit: `0afbcb4`
- `社群管理` contains `社群訂單` and `社群名單`; existing order/import/remittance/shipment flows remain unchanged.
- `社群名單` uses two standard tables. Approved bindings have separate LINE-name and nickname filters, nickname editing, and confirmed unbinding. Unbinding only clears the LINE-to-nickname binding.
- Pending bindings support row approval, select-all, and batch approval. Successful rows move to approved immediately; failed rows remain pending.
- Backend module and submenu order can be changed from the top-right `調整模塊順序` modal.
- Module order is shared across administrators through the existing `schedule_settings` row with type `backend-module-order`; it is not stored in browser storage.

## Staging data

- Community migrations through `202609210002_community_line_binding_reviews.sql` are applied to Staging.
- No migration was added for the current backend UI work.
- Migration files do not execute automatically in Production.

## Rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- Community frontend deployments must never update the Staging alias.
- Backend `main` and Production remain untouched unless explicitly approved.
