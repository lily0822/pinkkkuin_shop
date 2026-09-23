# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`; feature commit `0c4a630`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_RwKP6jwMkb8pJnRfgwfuBVe2xFpa`.
- Shared Staging backend remains on the current `official-next` deployment until local commit `ff71ba7` is explicitly authorized and pushed.
- Backend source commit `970ffd4` is pushed to `backend-staging`.
- `pinkkkuin-staging.vercel.app` belongs only to `official-next`; never update it from this branch.
- Production is untouched and must never be deployed without explicit approval.

## Community order and payment flow

- Staging migrations are applied through `202609230001_community_multi_notebook_payment_batches.sql`; none are applied to Production.
- A payment batch may contain multiple notebooks. New submissions persist a stable `batch_key` and one immutable snapshot row per notebook with product total, discount, and payable amount.
- Each newly selected notebook receives a fixed discount of up to NT$20; payable never falls below NT$0. `not_bought` items remain visible and never enter product totals.
- Top-ups stay in the same batch, keep every payment record, and use the discounted batch payable as their comparison base. Overpayments and refund records also remain batch-traceable.
- Historical single-notebook submissions are grouped with their existing top-ups and receive no retroactive discount, preserving old accounting values.
- Desktop community orders use independent unpaid and paid columns. Unpaid selection drives one payment panel and selected total; paid selection only allows fully arrived, unlocked notebooks and reuses existing 7-11/meetup flows.
- Mobile/tablet rendering remains on the existing layout.
- Existing LINE binding, notebook grouping, bought/not_bought, arrival, shipment, meetup, cancellation locks, payment history, and safe item/order deletion remain in place.

## Verification status

- Community and official-next builds pass locally; backend inline JavaScript syntax passes.
- Community deployment smoke: `/` 200, `/community-orders` 200, unauthenticated orders API 401.
- Full database E2E for 1/2/3 notebooks, top-up, overpayment/refund, and cleanup still requires a transaction-capable Staging SQL test because REST service credentials cannot delete protected payment history safely.
- `official-next` local commit `ff71ba7` contains the shared backend API, migration, and backend gitlink, but automatic approval rejected the push pending explicit user authorization.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
