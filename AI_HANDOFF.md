# AI Handoff — community-orders

## Current baseline

- Branch: `community-orders`
- Community alias: `https://pinkkkuin-community-orders.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend` (owned by `official-next`)
- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
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
- `查詢訂單` remains separate from nickname submission.
- Community import, orders, remittance, and shipment flows remain unchanged.
- Shared backend `社群名單` and module ordering remain owned and deployed by `official-next`.

## Staging data

- Community migrations through `202609210002_community_line_binding_reviews.sql` are applied to Staging.
- This LINE redirect fix adds no migration and changes no environment or permissions.

## Deployment rules

- Deploy this branch only to its Git Preview and `pinkkkuin-community-orders.vercel.app`.
- Never update `pinkkkuin-staging.vercel.app` from this branch.
- Never deploy Production without explicit approval.
