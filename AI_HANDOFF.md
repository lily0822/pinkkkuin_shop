# AI Handoff — Pinkkkuin Staging

## Current baseline

- `official-next` feature commit: `6db83f4`.
- Storefront/shared backend Staging: `https://pinkkkuin-staging.vercel.app` → `dpl_EahhtMRJWcPJvPHbdPqboAezeJkX`.
- Backend source commit: `411167a`, pushed to `backend-staging` and referenced by `official-next`.
- `community-orders` feature commit: `ef03a07`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_7sHBk1fivMDXTRcDYPMq5WACQkyS`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Community payments

- Staging migrations remain applied through `202609230001_community_multi_notebook_payment_batches.sql`; no migration was added this round.
- Multi-notebook payment batches, NT$20 per-notebook discount, top-ups, overpayment refunds, old single-notebook compatibility, shipment, meetup, and independent desktop selection remain unchanged.
- Shared backend remittance API once again returns review status, cumulative received, remaining/overpaid amounts, rejection/refund metadata, and exposes the existing protected same-origin `PATCH` handler.
- Pending batch review now shows the calculated action: `核准`, `需補款`, or `多匯待退款`; rejection still requires a reason. All actions use the existing batch-aware RPCs.
- Backend import history is the final block on the community orders page.

## Verification

- `official-next` build: PASS.
- Backend inline JavaScript syntax: PASS.
- Shared backend login page: PASS.
- Unauthenticated remittance API guard: PASS.
- No DB, migration, payment model, shipment, meetup, or Production changes.

## Fixed deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `pinkkkuin-community-orders.vercel.app` belongs only to `community-orders`.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
