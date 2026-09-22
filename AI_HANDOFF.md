# AI Handoff — official-next

## Current baseline

- Branch: `official-next`
- Storefront Staging: `https://pinkkkuin-staging.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`
- Community frontend: `https://pinkkkuin-community-orders.vercel.app`
- Production: `https://pinkkkuin-shop.vercel.app` — never deploy without explicit approval.

## Community notebook and item status

- Shared backend source commit: `5a134b7` on `backend-staging`.
- Shared API/migration feature commit: `e3434b8` on `official-next`.
- Migration `202609220002_community_notebook_item_statuses.sql` is applied to Staging only.
- `community_order_items.purchase_status` supports `bought` and `not_bought`.
- `community_order_items.arrival_status` supports `not_arrived`, `arrived`, and `exception`.
- Existing rows default to `bought` / `not_arrived`; no existing item was deleted.
- Backend `社群訂單` includes notebook summaries and `整本設為已到貨`.
- Whole-notebook arrival updates bought items only. Not-bought items remain unchanged.
- Each item keeps independent purchase and arrival controls, including manual exception or not-arrived overrides after a notebook-wide update.
- Existing payment, remittance, shipment, face-to-face, safe item deletion, and final-item order deletion flows remain unchanged.
- Public/backend order APIs enrich existing RPC results with item statuses and a bought-only notebook total without changing legacy RPC signatures.

## Staging data

- Community migrations through `202609220002_community_notebook_item_statuses.sql` are applied to Staging.
- These community migrations are not applied to Production.

## Deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `community-orders` must use `pinkkkuin-community-orders.vercel.app` and must never update the storefront Staging alias.
- Production and Production aliases remain untouched unless explicitly approved.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on its detached HEAD, commit there, then push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
- Before a build/deploy involving `/backend`, confirm the parent gitlink and nested repo HEAD match.
