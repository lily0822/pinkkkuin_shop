# AI Handoff — Pinkkkuin Staging

## Current baseline

- `official-next` feature commit: `2bb4461`.
- Storefront/shared backend Staging: `https://pinkkkuin-staging.vercel.app` → `dpl_3WR2sdTeVeY3Crdk1XuYMjajbYUk`.
- Backend source commit: `5e5473d`, pushed to `backend-staging` and referenced by `official-next`.
- `community-orders` feature commit: `34e08b3`.
- Community frontend: `https://pinkkkuin-community-orders.vercel.app` → `dpl_FwxbBsGAVj1AdFB4995CmfvQLheb`.
- Production is untouched and requires explicit authorization for every deploy, migration, or write.

## Fulfillment history

- The 7-11 request modal only shows selected notebooks, bought product names, and quantities. Recipient, phone, and pickup-store inputs are removed; buyers complete them in the marketplace later.
- Pending/accepted 7-11 requests remain in the paid area as `7-11 出貨申請中` and remain locked.
- Pending/confirmed meetups remain in the paid area as `面交申請中` and remain locked.
- Cancelled requests unlock their notebooks; completed requests remain locked.
- Backend marketplace URL creation moves shipment status to `accepted` and records `accepted_at`.
- Backend `送出 LINE 下單通知` moves shipment status to `completed` and records `completed_at`; it does not add LINE Messaging API integration.
- Completed 7-11 and meetup requests leave the paid area and appear in the `歷史訂單` modal table.
- 7-11 history shows `7-11 出貨｜已通知下單` and marketplace creation time; meetup history shows `面交｜已完成` and the selected appointment date/time.

## Data and verification

- No migration was added. Existing `accepted_at`, `completed_at`, and meetup slot fields provide the required traceability.
- Staging migrations remain applied through `202609230001_community_multi_notebook_payment_batches.sql`.
- Community build: PASS. Backend inline JavaScript syntax: PASS.
- Community route, shared backend route, and official-next Staging route: HTTP 200.

## Fixed deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `pinkkkuin-community-orders.vercel.app` belongs only to `community-orders`.
- Never deploy Production or run Production migrations without explicit approval.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on detached HEAD and push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
