# AI Handoff — official-next

## Current baseline

- Branch: `official-next`; feature baseline commit `a53862b`.
- Storefront Staging: `https://pinkkkuin-staging.vercel.app` → `dpl_2UBAYDLe166maYYrhFcFCxGqXBWS`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_73p2Ve6FZN1VebRisNqDQD1BwrYn` on separate `community-orders` commit `f5a6978`.
- Backend source: `d2ca38d` on `backend-staging`.
- Production: `https://pinkkkuin-shop.vercel.app`; untouched and never deploy without explicit approval.

## Community orders

- Staging migrations are applied through `202609220006_community_meetup_workflow.sql`; none are applied to Production.
- One customer × one notebook is the payment unit. `not_bought` items remain visible and are excluded from payable, arrival, shipment, and meetup eligibility calculations.
- Payment supports unpaid, review, rejection, top-up, paid, overpaid refund, and refund completion with append-only history.
- 7-11 supports multiple paid, fully arrived notebooks. Statuses: `pending`, `accepted`, `completed`, `cancelled`; cancellation releases locks.
- Meetup supports multiple fully arrived notebooks without requiring prepayment. Payment methods: `prepaid`, `pay_at_meetup`; statuses: `pending`, `confirmed`, `completed`, `cancelled`.
- `pay_at_meetup` completion adds traceable approved remittance records and marks the included notebook orders paid. `prepaid` completion requires the orders to already be paid and creates no duplicate payment.
- Active or completed shipment/meetup requests share one cross-workflow lock. Cancellation releases it; completion keeps it.
- Backend can create/edit/open/close meetup slots and update meetup requests. Different dates may use different locations; no capacity limit is applied.
- Full Staging E2E passed for multi-notebook shipment, unpaid meetup, prepaid meetup, pay-at-meetup, cancel/unlock, complete/lock, distinct locations, and not-arrived rejection. Temporary E2E data was fully removed (all verification counts `0`).
- Existing notebook grouping, purchase/arrival states, whole-notebook arrival, per-item exceptions, payment/refund history, and safe item/order deletion remain in place.

## Deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `pinkkkuin-community-orders.vercel.app` belongs only to `community-orders`.
- Production and Production aliases remain untouched unless explicitly approved.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD, commit there, then push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
