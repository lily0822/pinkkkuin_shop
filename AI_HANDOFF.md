# AI Handoff — official-next

## Current baseline

- Branch: `official-next`
- Storefront Staging: `https://pinkkkuin-staging.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`
- Production: `https://pinkkkuin-shop.vercel.app` — never deploy without explicit approval.
- The `community-orders` frontend remains separate at `https://pinkkkuin-community-orders.vercel.app`.

## Shared backend

- Backend source repo branch: `backend-staging`
- Backend commit: `448293d920b88a0713517f2618fe02def718435e`
- The Staging backend includes the top-level `社群管理` module with `社群訂單` and `社群名單`.
- The existing community order/import/remittance/shipment functions remain in `社群訂單`.
- `社群名單` uses two standard backend tables. Approved members support client-side LINE name/nickname search; pending members support row approval, select-all, and batch approval through the existing approval API.
- `official-next` carries only the backend API routes and migration history needed by this shared backend; it does not include the community-orders frontend or LINE callback UI.

## Staging data

Community migrations through `202609210002_community_line_binding_reviews.sql` are applied to Staging. Migration files do not execute automatically in Production.

## Rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- Community frontend deployments must never update the Staging alias.
- Backend `main` and Production remain untouched unless explicitly approved.
