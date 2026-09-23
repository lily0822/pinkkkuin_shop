# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`; feature baseline commit `f5a6978`.
- Community test frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_73p2Ve6FZN1VebRisNqDQD1BwrYn`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend` → official-next deployment `dpl_2UBAYDLe166maYYrhFcFCxGqXBWS`.
- Backend source: `d2ca38d` on `backend-staging`.
- `pinkkkuin-staging.vercel.app` belongs only to `official-next` and must never be updated from this branch.
- Production is untouched and must never be deployed without explicit approval.

## Community order flow

- Staging migrations are applied through `202609220006_community_meetup_workflow.sql`; none are applied to Production.
- One customer × one notebook is the payment unit. `not_bought` items remain visible and do not affect payable, arrival, shipment, or meetup eligibility.
- 7-11 allows multiple paid, fully arrived notebooks. Pending/accepted/completed requests lock notebooks; cancellation unlocks them.
- Meetup allows multiple fully arrived notebooks without requiring payment first. Open, non-expired slots provide date, start/end time, and location.
- Meetup payment methods are `prepaid` and `pay_at_meetup`; statuses are `pending`, `confirmed`, `completed`, and `cancelled`.
- `pay_at_meetup` completion creates traceable approved remittance records and marks included notebook orders paid. `prepaid` completion requires existing payment and does not duplicate payment history.
- Shipment and meetup share one lock. Cancelled requests release it; completed requests stay locked and cannot be submitted again.
- The frontend clearly shows locked shipment/meetup status, slot details, payment method, marketplace state, and blocks unarrived notebooks from selection. Unpaid arrived notebooks may choose meetup but cannot submit 7-11.
- Full Staging E2E passed for multi-notebook shipment/meetup, prepaid/pay-at-meetup, cancel/unlock, complete/lock, different locations, and not-arrived rejection. Temporary E2E data was fully removed (all verification counts `0`).
- Existing LINE binding, notebook grouping, item status, payment/top-up/refund history, arrival operations, and safe deletion remain unchanged.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
