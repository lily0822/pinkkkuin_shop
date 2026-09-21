# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`

**Staging (test)**
- 商城前台: `https://pinkkkuin-staging.vercel.app`
- 共用後台: `https://pinkkkuin-staging.vercel.app/backend` (owned and deployed by `official-next`; this branch must never be aliased to or described as this entry)
- 社群訂單前台: `https://pinkkkuin-community-orders.vercel.app` (this branch's own alias; its own `/backend` is not a test or admin entry point)

**Production**
- 商城前台: `https://pinkkkuin-shop.vercel.app`
- 商城後台: `https://pinkkkuin-shop.vercel.app/backend`
- Production must not be deployed without explicit approval.

## Community LINE flow

- Community LINE Login starts at `/api/community/line/start`.
- Its signed OAuth state includes `source: community-orders` and `returnTo: /`.
- Its OAuth redirect URI is `https://pinkkkuin-community-orders.vercel.app/api/community/line/callback`.
- Community callback always redirects to `https://pinkkkuin-community-orders.vercel.app/`; it never derives the destination from a storefront callback host.
- The storefront `/api/member/line/start` and member callback behavior are unchanged.
- First-time LINE users continue to nickname review; approved users load their saved binding and community orders automatically.

## Existing accepted features

- Nickname applications remain pending until backend approval; only approved nicknames can query orders.
- Approval only depends on review state (`pending`) and nickname-conflict checks; it does not require the nickname to already have a community order. A nickname with zero orders can be approved and moves to the approved list immediately.
- `查詢訂單` remains separate from nickname submission, and its own "查無訂單" message is unaffected by approval logic.
- Community import, orders, remittance, and shipment flows remain unchanged.
- Shared backend `社群名單` and module ordering remain owned and deployed by `official-next` (see entry points above).
- The nickname-approval order-lookup fix was applied identically on `official-next` (commit `80a6473`) and deployed to the real Staging backend, `https://pinkkkuin-staging.vercel.app/backend`. This branch also carries the same source fix (commit `291b3ca`) so the two stay in sync, but `official-next` is the branch of record for that endpoint.

## Staging data

- Community migrations through `202609210002_community_line_binding_reviews.sql` are applied to Staging.
- The nickname-approval fix adds no migration and changes no environment or permissions.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.
