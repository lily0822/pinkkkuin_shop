# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`
- Community test frontend: `https://pinkkkuin-community-orders.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`, owned by `official-next`.
- `pinkkkuin-staging.vercel.app` must never be updated from this branch.
- Production must never be deployed without explicit approval.

## Community payment flow

- Backend source commit: `cb49a92` on `backend-staging`.
- Shared API/migration feature commit: `dcbbb7f` on `official-next`.
- Community frontend feature commit: `ce5af7e`.
- Staging migrations are applied through `202609220004_community_payment_accumulation_refunds.sql`; none are applied to Production.
- One customer × one notebook is one payment unit; `not_bought` items are excluded from the payable total.
- The frontend shows payable total, cumulative received, remaining top-up, overpaid amount, and every payment/refund record with status and time.
- Underpayment becomes `topup_required` and accepts a new append-only submission.
- Exact cumulative payment becomes `approved` after backend review.
- Overpayment becomes `overpaid_pending_refund`; backend refund completion adds a separate refund record and becomes `refund_completed`.
- Rejected submissions keep their reason and can be resubmitted without overwriting history.
- Existing LINE binding, notebook grouping, item purchase/arrival states, shipment flow, and safe deletion remain unchanged.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
