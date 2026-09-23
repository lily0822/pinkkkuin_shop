# AI Handoff — Pinkkkuin Staging

## Current baseline

- Branch: `official-next`.
- Feature commit: `ebf8f4e` (`Align community backend order management`).
- Storefront/shared backend Staging: `https://pinkkkuin-staging.vercel.app` → `dpl_ETGRMmF3pGwu8LCmzRJTxDut7uhT`.
- Backend source commit: `d0f8064`, pushed to `backend-staging` and referenced by `official-next`.
- Community frontend feature commit: `61b8f53`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_EXWhZEzwcRbrW1JRv7kMZeUo6Jyb`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Current community admin UI

- Shipment request customer cells show only the LINE display name and bound community nickname.
- The main community order table is titled `訂單明細`; duplicate `搶購狀態` and `商品到貨` columns are removed.
- Notes remain text inputs and visually align with adjacent status controls.
- Notebook management is an accordion keyed by notebook name. Expanded rows show LINE name, nickname, product, variant, quantity, unit price, total, purchase status, and arrival status.
- Notebook management and the order table edit the same purchase/arrival data and refresh together.
- Editable status controls render as black-text pills. Purchase, payment, and arrival colors follow the current approved mapping.
- Orders are grouped by the notebook's first source occurrence and keep the existing import/source row order using existing timestamps and IDs. No schema change was added.

## Current community frontend UI

- Desktop binding/action card aligns with the unpaid + paid main content width.
- General order cards are white without decorative borders; unpaid/paid section styling and status pills remain unchanged.
- Shipment and meetup pending labels appear before the corresponding notebook title.
- Mobile layout was not refactored.

## Verification

- No migration was added. Staging migrations remain applied through `202609230001_community_multi_notebook_payment_batches.sql`.
- Root build: PASS. Community build: PASS. Backend inline JavaScript syntax: PASS.
- Community route and shared backend login route load successfully from their aliases.
- Multi-notebook payment, NT$20 discount, top-up/refund, fulfillment locks, cancellation unlock, history, safe deletion, and Excel import logic were not changed.

## Fixed deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `pinkkkuin-community-orders.vercel.app` belongs only to `community-orders`.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
