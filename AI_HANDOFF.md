# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`.
- Community test frontend: `https://pinkkkuin-community-orders.vercel.app`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`, owned by `official-next`.
- `pinkkkuin-staging.vercel.app` must never be updated from this branch.
- Production must never be deployed without explicit approval.

## Community order flow

- Backend source: `681b30a` on `backend-staging`.
- Shared shipment API/migration feature: `6c3957a` on `official-next`.
- Community shipment frontend feature: `4d3064d`.
- Staging migrations are applied through `202609220005_community_seven_eleven_shipments.sql`; none are applied to Production.
- One customer × one notebook remains the payment unit. `not_bought` items remain visible and are excluded from payable and shipment-arrival checks.
- Payment supports unpaid, pending review, rejection, top-up, paid, overpaid pending refund, and refund completed with append-only payment/refund history.
- Customers may select multiple eligible notebooks for one 7-11 request. Every selected notebook must be paid and all `bought` items must be arrived.
- Submitted, accepted, and completed requests lock included notebooks. Cancelled requests release the lock.
- The frontend displays `已申請出貨` and the request status. It shows `賣貨便建立中` until a URL exists, then displays `前往賣貨便填寫取貨資料`.
- Face-to-face remains a reserved button/state only; no scheduling or location workflow is implemented.
- Existing LINE binding, notebook grouping, purchase/arrival states, payment/refund history, and safe deletion remain unchanged.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
