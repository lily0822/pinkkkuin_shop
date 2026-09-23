# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`.
- Latest feature commit: `179b838` (`Refine desktop community order grouping`).
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → deployment `dpl_6goM8ekPixGtasHJazYXohb8gLBZ`.
- Shared Staging backend remains `https://pinkkkuin-staging.vercel.app/backend` and belongs to `official-next`.
- `pinkkkuin-staging.vercel.app` must never be updated from this branch.
- Production is untouched and requires explicit authorization for any deployment or write.

## Community order desktop UI

- Desktop uses centered equal-width unpaid and paid columns at `max-w-5xl`.
- Each column has one shared rounded container; notebook sections are separated by soft dashed dividers.
- Selecting a notebook highlights the whole section in its column color. Unpaid and paid selection states remain independent.
- Bound nickname, `更新訂單`, and `更換綁定暱稱` share one desktop row, with actions aligned right.
- A valid LINE binding automatically loads the customer's orders on page entry; `更新訂單` manually refreshes them.
- Compact item rows and all existing payment, NT$20 per-notebook discount, top-up/refund, shipment, meetup, lock, and arrival behavior remain unchanged.
- Mobile/tablet layout was not restructured by this change.

## Data and migrations

- Staging migrations are applied through `202609230001_community_multi_notebook_payment_batches.sql`.
- No migration was added or executed for the desktop UI change.
- Production migrations remain untouched.

## Verification

- `npm run build`: PASS.
- `git diff --check`: PASS.
- Desktop grouping, divider, selection highlight, automatic load, refresh wording, and same-row binding actions: PASS by code/build verification.
- Git integration deployment `dpl_6goM8ekPixGtasHJazYXohb8gLBZ`: READY.
- Community alias update: PASS.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push backend changes with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
