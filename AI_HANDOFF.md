# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`; feature commit `ef03a07`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_7sHBk1fivMDXTRcDYPMq5WACQkyS`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend` → official-next deployment `dpl_EahhtMRJWcPJvPHbdPqboAezeJkX`.
- Shared backend source commit: `411167a`; official-next feature commit: `6db83f4`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Community frontend

- A bound LINE user automatically loads their orders.
- The bound nickname action area contains `匯款紀錄`, `更新訂單`, and `更換綁定暱稱`.
- `匯款紀錄` opens a modal grouped by payment batch and shows notebooks, product total, NT$20-per-notebook discount, payable total, remittance details, status, top-up history, refund history, and rejection reasons.
- Pending payment badges use a pale beige-yellow pill with dark text.
- Existing desktop unpaid/paid grouping and independent selection remain unchanged; mobile layout was not restructured.

## Data and workflow

- Staging migrations remain applied through `202609230001_community_multi_notebook_payment_batches.sql`; no migration was added this round.
- Multi-notebook payments, NT$20 discount, top-ups, refunds, old single-notebook compatibility, shipment, meetup, locks, and arrival states remain unchanged.

## Verification

- Community build: PASS.
- Community page/alias smoke: PASS.
- Shared backend build, inline JavaScript, login page, and unauthenticated API guard: PASS.
- No DB, migration, payment model, shipment, meetup, mobile layout, or Production changes.

## Fixed deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
