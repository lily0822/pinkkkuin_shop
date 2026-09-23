# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`.
- Feature commit: `61b8f53` (`Refine community order desktop UI`).
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_EXWhZEzwcRbrW1JRv7kMZeUo6Jyb`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend` → official-next deployment `dpl_ETGRMmF3pGwu8LCmzRJTxDut7uhT`.
- Shared backend source commit: `d0f8064`; official-next feature commit: `ebf8f4e`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Current frontend UI

- Desktop binding/action card uses the same `lg:max-w-5xl` boundary as the unpaid + paid main content.
- General order cards use a white background without decorative borders; buttons, status pills, and the unpaid/paid section styling are preserved.
- `7-11 出貨申請中` and `面交申請中` appear before the corresponding notebook title.
- Desktop unpaid and paid selections, multi-notebook payment, NT$20 per-notebook discount, top-up/refund, and fulfillment actions are unchanged.
- Mobile layout was not refactored.

## Shared backend state

- Shipment request customer cells show only LINE display name and bound community nickname.
- Community order main table is titled `訂單明細`; duplicate `搶購狀態` and `商品到貨` columns are removed.
- Notebook management is an accordion keyed by notebook name and edits the same purchase/arrival status data as the main order table.
- Editable status controls render as black-text pills using the approved purchase/payment/arrival colors.
- Notebook groups and rows preserve existing Excel/source order through existing timestamps and IDs; no schema change was added.

## Verification

- No migration was added. Staging migrations remain applied through `202609230001_community_multi_notebook_payment_batches.sql`.
- Community build: PASS. Root build: PASS. Backend inline JavaScript syntax: PASS.
- Community alias route and shared backend login route load successfully.
- Existing payment, shipment, meetup, locking, history, safe deletion, and Excel import behavior was not changed.

## Next round

- Lock the frontend payment amount so customers cannot edit it.
- Make the current amount due visually prominent.
- Customers enter only the bank and the last five digits.
- Add a reminder before payment submission.
- Simplify frontend status wording.
- Make operation success feedback clearer.
- Add a short frontend process guide.
- Add a pending-work summary to the backend.
- Do not change the underpayment or overpayment flows yet.

## Fixed deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
