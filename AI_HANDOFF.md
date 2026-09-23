# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`; feature commit `34e08b3`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_FwxbBsGAVj1AdFB4995CmfvQLheb`.
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend` → official-next deployment `dpl_3WR2sdTeVeY3Crdk1XuYMjajbYUk`.
- Shared backend source commit: `5e5473d`; official-next feature commit: `2bb4461`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Fulfillment history

- The 7-11 request modal only shows selected notebooks, bought product names, and quantities. Recipient, phone, and pickup-store inputs are removed.
- A successful request displays `申請通過！1–2 天內會私訊賣場連結，感謝捧場 ♡`.
- Pending/accepted 7-11 requests stay in the paid area as `7-11 出貨申請中`; pending/confirmed meetups stay as `面交申請中`.
- These notebooks are disabled and cannot be selected again. Cancelled requests unlock them; completed requests remain locked.
- `歷史訂單` is a modal table with series, product, quantity, unit price, subtotal, fulfillment method, and time.
- Only completed fulfillment appears in history: 7-11 after the backend marks LINE ordering notice sent, and meetup after completion.
- 7-11 history uses marketplace creation time; meetup history uses the selected appointment date/time.

## Data and verification

- No migration was added. Existing shipment `accepted_at`/`completed_at` and meetup slot fields are reused.
- Staging migrations remain applied through `202609230001_community_multi_notebook_payment_batches.sql`.
- Community build: PASS. Community alias route: HTTP 200.
- Multi-notebook payments, NT$20 discount, top-ups/refunds, selection, shipment/meetup locks, and payment history remain unchanged.

## Fixed deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
