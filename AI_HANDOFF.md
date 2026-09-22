# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`
- Community test frontend: `https://pinkkkuin-community-orders.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`, owned by `official-next`.
- Storefront Staging alias `pinkkkuin-staging.vercel.app` must never be updated from this branch.
- Production must never be deployed without explicit approval.

## Community frontend

- LINE Login remains isolated from the storefront and returns to the community frontend.
- Nickname applications require backend approval; approved bindings automatically load the user’s community orders.
- Community notebook/item-status feature commit: `0e9be59`.
- Orders are grouped as one card per customer and notebook.
- Each item shows product, variant, quantity, unit price, subtotal, purchase status, and arrival status.
- Purchase status is `有買到` or `沒買到`; arrival status is `未到貨`, `已到貨`, or `異常` for bought items.
- Each notebook card shows `有買到商品合計`, excluding not-bought items.
- Existing payment/remittance/shipment selection and submission logic is unchanged.

## Shared backend and Staging data

- Shared backend source commit: `5a134b7` on `backend-staging`.
- Shared API/migration commit: `e3434b8` on `official-next`.
- Migration `202609220002_community_notebook_item_statuses.sql` is applied to Staging only.
- The backend notebook management area supports notebook summaries, whole-notebook arrival, and per-item overrides.
- Existing safe item/order deletion behavior remains unchanged.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Before a build/deploy involving `/backend`, confirm the parent gitlink and nested repo HEAD match.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
