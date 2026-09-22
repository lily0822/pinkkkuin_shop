# AI Handoff — official-next

## Current baseline

- Branch: `official-next`.
- Storefront Staging: `https://pinkkkuin-staging.vercel.app`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` on the separate `community-orders` branch.
- Production: `https://pinkkkuin-shop.vercel.app`; never deploy without explicit approval.

## Community orders

- Backend source: `681b30a` on `backend-staging`.
- Shared shipment API/migration feature: `6c3957a` on `official-next`.
- Community shipment frontend feature: `4d3064d` on `community-orders`.
- Staging migrations are applied through `202609220005_community_seven_eleven_shipments.sql`; none are applied to Production.
- One customer × one notebook remains the payment unit. `not_bought` items remain visible and are excluded from payable and shipment-arrival checks.
- Payment supports unpaid, pending review, rejection, top-up, paid, overpaid pending refund, and refund completed with append-only payment/refund history.
- 7-11 shipment supports selecting multiple notebooks. Every selected notebook must be paid and all `bought` items must be arrived.
- Active or completed shipment requests lock their notebooks against duplicate shipment/face-to-face requests. Cancelling a request unlocks them.
- Shipment statuses are `pending`, `accepted`, `completed`, and `cancelled`. Marketplace URL/reference fields are nullable and manually managed in the shared backend.
- Existing notebook grouping, purchase/arrival states, whole-notebook arrival, per-item exceptions, and safe item/order deletion remain in place.

## Deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `pinkkkuin-community-orders.vercel.app` belongs only to `community-orders`.
- Production and Production aliases remain untouched unless explicitly approved.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on its detached HEAD, commit there, then push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
