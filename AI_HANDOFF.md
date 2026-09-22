# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`
- Community test frontend: `https://pinkkkuin-community-orders.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`, owned by `official-next`.
- `pinkkkuin-staging.vercel.app` must never be updated from this branch.
- Production must never be deployed without explicit approval.

## Community frontend and payments

- LINE Login remains isolated from the storefront and returns to the community frontend.
- Approved nickname bindings automatically load the customer’s community orders.
- Basic payment feature commit: `459f60f`.
- One customer × one notebook is one payment unit.
- Each notebook card shows the bought-only payable total and offers 中信、國泰、富邦 payment submission with amount and account last five digits.
- `not_bought` items remain visible and are excluded from the payable total.
- Payment states are 未付款、待審核、已付款、審核退回. Rejection reasons are shown and rejected payments can be resubmitted.
- Resubmission creates a new append-only record and does not overwrite the rejected record.
- Existing notebook grouping, purchase/arrival statuses, shipment flow, and safe deletion behavior remain unchanged.

## Shared backend and Staging data

- Backend source commit: `5466240` on `backend-staging`.
- Shared API/migration feature commit: `40eb180` on `official-next`.
- Staging migrations are applied through `202609220003_community_basic_payment_review.sql`.
- Community migrations are not applied to Production.
- Backend payment review supports approval and rejection with a required reason.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
