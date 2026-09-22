# AI Handoff — official-next

## Current baseline

- Branch: `official-next`
- Storefront Staging: `https://pinkkkuin-staging.vercel.app`
- Shared Staging backend: `https://pinkkkuin-staging.vercel.app/backend`
- Community frontend: `https://pinkkkuin-community-orders.vercel.app`
- Production: `https://pinkkkuin-shop.vercel.app` — never deploy without explicit approval.

## Community orders

- Backend source commit: `5466240` on `backend-staging`.
- Basic payment API/migration feature commit: `40eb180` on `official-next`.
- Community frontend payment feature commit: `459f60f` on `community-orders`.
- Staging migrations are applied through `202609220003_community_basic_payment_review.sql`; none of these community migrations are applied to Production.
- Orders remain grouped by customer and notebook. `bought` items count toward the notebook payable total; `not_bought` items remain visible and are excluded.
- Basic payment statuses are `unpaid`, `pending`, `approved`, and `rejected`.
- Each submission is append-only. A rejected payment can be resubmitted as a new record; the rejected record is retained.
- Backend payment review supports approval and rejection with a required reason. Approval marks the related notebook order paid; rejection restores it to unpaid.
- Existing notebook grouping, purchase/arrival statuses, whole-notebook arrival, per-item exceptions, and safe item/order deletion remain in place.

## Deployment rules

- `pinkkkuin-staging.vercel.app` belongs only to `official-next`.
- `community-orders` uses `pinkkkuin-community-orders.vercel.app` and must never update the storefront Staging alias.
- Production and Production aliases remain untouched unless explicitly approved.

## Backend submodule safety

- `.backend-product-publish` is a separate repository.
- Work on its detached HEAD, commit there, then push with `git push origin HEAD:backend-staging`.
- Do not check out the diverged local `backend-staging` branch.
- Before a build/deploy involving `/backend`, confirm the parent gitlink and nested repo HEAD match.
