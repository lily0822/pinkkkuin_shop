# AGENTS.md

This file gives Codex project instructions for the Pinkkkuin shop workspace.
It replaces the Claude-specific guidance in `CLAUDE.md` with Codex-oriented
working rules. Read this file before editing the repo, then consult `docs/`
for module-specific context.

## Canonical Project

- The only official storefront project is:
  `C:\Users\lily.deng\Desktop\pinkkkuin_shop`
- Do not use `C:\Users\lily.deng\Desktop\AITEST` as a development source.
  Treat it as legacy/archive reference only.
- The backend admin source lives inside this workspace but is a separate repo:
  `.backend-product-publish`

## Repositories And Branches

### Storefront

- Repo: `https://github.com/lily0822/pinkkkuin_shop.git`
- Main working branch: `official-next`
- Release branch created from current release baseline: `release/2026-08-25`
- Framework: Next.js + React
- Production frontend: `https://pinkkkuin-shop.vercel.app`
- Staging frontend: `https://pinkkkuin-staging.vercel.app`

### Backend Admin

- Repo: `https://github.com/lily0822/workspace.git`
- Working branch: `main`
- Release branch created from current release baseline: `release/2026-08-25`
- Production backend: `https://lily0822.github.io/workspace/lily-backend.html`
- Staging backend: `https://pinkkkuin-staging.vercel.app/backend`
- Local source:
  - `.backend-product-publish/lily-backend.html`
  - `.backend-product-publish/lily-backend-Code.gs`

## Environment Rules

Never mix production and staging data.

### Production

- Frontend: Vercel Production, `https://pinkkkuin-shop.vercel.app`
- Backend: GitHub Pages + production Apps Script
- Data:
  - Production Supabase
  - Production Google Sheet
  - Cloudinary account currently shared with staging
- Production must not display a `STAGING` badge.

### Staging

- Frontend: Vercel Preview with fixed alias,
  `https://pinkkkuin-staging.vercel.app`
- Backend: `/backend` route on staging alias
- Data:
  - `pinkkkuin-staging` Supabase
  - staging Apps Script
  - staging Google Sheet
- Staging must display a `STAGING` badge.
- Vercel Preview uses:
  - `APP_ENV=staging`
  - `SUPABASE_ENV=staging`
  - staging `SUPABASE_URL`
  - staging `SUPABASE_ANON_KEY`
  - `STAGING_BACKEND_API_URL`

### Local Development

- Storefront: `http://127.0.0.1:3000`
- Use `.env.local` for staging Supabase values.
- Local backend HTML should be served over HTTP, not opened through `file://`.
- Local backend staging override is:
  `.backend-product-publish/backend-env.local.js`
- `backend-env.local.js` must stay ignored and must never be committed.

## Secrets And Ignored Files

Do not commit or print secrets.

Never stage:

- `.env`
- `.env.*` except `.env.example`
- `.vercel`
- `.backend-product-publish/backend-env.local.js`
- `node_modules/`
- `.next/`
- `.wrangler/`
- `*.log`
- `.tmp-*`
- `shop-env.js`
- `public/shop-env.js`
- real Supabase URLs or keys
- Cloudinary API secrets
- Apps Script staging `/exec` URL if it is local-only

Before commits, run a secret scan and inspect staged files.

## Data Sources

### Storefront Reads

- Product lists and categories: Supabase via `src/lib/storefront-products.ts`
- Product detail: Supabase via `src/lib/product-detail.ts`
- Gallery images: `product_images`
- Variants: `product_variants`
- Appearance settings: `schedule_settings` through:
  - `src/lib/appearance-settings.ts`
  - `src/lib/brand-settings.ts`
- Cart: browser `localStorage`, key `pinkkkuin_cart_items`

Static product data in `src/lib/products.ts` is legacy fallback only. Do not
make it the primary catalog source again.

### Backend Writes

The production backend writes through Apps Script:

`lily-backend.html -> lily-backend-Code.gs -> Google Sheet + Supabase mirror`

Important tables:

- `products`
- `product_images`
- `product_variants`
- `categories`
- `product_categories`
- `schedule_settings`
- `vendors`
- `websites`
- `backend_orders`
- `stall_schedules`
- `connection_schedules`
- `orders`
- `order_items`

## Media Uploads

- Upload/delete endpoint: `src/app/api/upload/route.ts`
- Provider: Cloudinary
- Cloudinary secret must stay server-side only.
- Do not store Base64 images in Supabase or Google Sheet.
- Store Cloudinary `secure_url` and `public_id`.
- Current Cloudinary staging/production split is incomplete: both environments
  still share the same Cloudinary account. Treat this as a known risk.

Common folders:

- `products/`
- `site/logo/`
- `site/banners/`
- `site/watermark/`
- `site/brand-text/`
- `site/favicon/`
- `site/og/`

## Important Current Risks

See `docs/risk-review.md` for the full list. Highest-priority risks:

- Backend save can succeed in Google Sheet while Supabase mirror fails.
- Read and write paths are asymmetric:
  - writes: Google Sheet first, Supabase mirror
  - reads: Supabase first, Google Sheet fallback
- Production/staging Cloudinary is not fully separated.
- Some legacy/admin data still uses browser localStorage.
- `schedule_settings` is used as a generic KV table with JSON in the `image`
  column.
- Do not let product tag type preservation regress: an existing `ip` category
  must not be overwritten back to `category` by product saves or imports.

## Development Workflow

1. Confirm you are in `C:\Users\lily.deng\Desktop\pinkkkuin_shop`.
2. Read the relevant docs before changing a module.
3. Prefer small, scoped edits.
4. Do not touch AITEST.
5. Do not deploy Production unless the user explicitly approves it.
6. Do not modify production Supabase, production Apps Script, or production
   Vercel env unless explicitly approved.
7. For staging tests, verify the environment is staging before writing data.
8. Clean up TEST data unless the user explicitly asks to leave it for manual
   testing.
9. Run `npm run build` after frontend changes.
10. Run backend HTML/inline JS syntax checks after admin changes.
11. Use explicit `git add <files>`; do not blindly stage everything.

## Module Documentation

Read these before touching the related area:

- `docs/architecture.md` - system architecture and data flow
- `docs/environments.md` - staging/production/local environment rules
- `docs/data-model.md` - Google Sheet, Supabase, and frontend data shapes
- `docs/risk-review.md` - known risks and prioritization
- `docs/module-backend-api.md` - Apps Script API and Supabase sync layer
- `docs/module-media-upload.md` - Cloudinary upload/delete flow
- `docs/module-product-management.md` - stock/preorder product admin
- `docs/module-product-tags.md` - IP/category tag management
- `docs/module-brand-appearance.md` - logo, banners, announcements, appearance
- `docs/module-purchasing.md` - purchasing workflows
- `docs/module-customer-orders.md` - customer order details
- `docs/module-schedules.md` - stall/connection schedules
- `docs/module-accounting.md` - ledger/accounting areas
- `docs/module-exchange-rates.md` - exchange-rate UI
- `docs/module-legacy-portal.md` - legacy portal pages

## Deployment Guardrails

- Preview/staging deploys are allowed only when requested.
- Production deploys require explicit user approval.
- Do not promote Preview to Production without approval.
- Do not merge `official-next` into `main` unless the user asks.
- Do not assume GitHub Pages backend updates are live until the relevant branch
  has been pushed and Pages has redeployed.
- Pushing `lily-backend-Code.gs` does not redeploy Apps Script. The user must
  manually paste/update Code.gs and create a new Apps Script deployment unless
  another safe deployment mechanism is explicitly available.

