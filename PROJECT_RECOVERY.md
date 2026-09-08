# Project Recovery

This document is a recovery and parity checklist for Pinkkkuin Vercel,
Supabase, Git, LINE, and migration issues. It intentionally contains no
secrets, passwords, API keys, access tokens, service role keys, cookies, or raw
LINE user IDs.

## 1. Production / Staging

### Production

- Frontend: `https://pinkkkuin-shop.vercel.app`
- Backend: `https://pinkkkuin-shop.vercel.app/backend`
- Supabase project ref: `rodncaahpiiukakahnxd`
- Vercel project: `pinkkkuin-shop`
- Vercel team / scope: `lilys-projects-2a8e834c`
- Storefront repo: `https://github.com/lily0822/pinkkkuin_shop.git`
- Storefront branch: `official-next`
- Backend source repo: `git@github.com:lily0822/workspace.git`
- Backend staging branch: `backend-staging`

### Staging

- Frontend: `https://pinkkkuin-staging.vercel.app`
- Backend: `https://pinkkkuin-staging.vercel.app/backend`
- Supabase project ref: `lhjcfpbuknzqzpkujfji`
- Vercel project: `pinkkkuin-shop`
- Vercel team / scope: `lilys-projects-2a8e834c`
- Storefront branch: `official-next`
- Backend staging branch: `backend-staging`

### Important Checkpoints

- Storefront P-8 checkpoint: `d8dcfa4 feat: add member accounts and backend security hardening`
- Admin LINE checkpoint: `8acdd30 feat: add LINE admin order notifications`
- Backend password management checkpoint: `85a298e feat: add backend password management`
- Protected Supabase diagnostic checkpoint: `cc657b5 chore: add protected production supabase diagnostic`
- Secure backend admin auth checkpoint: `d0d17b3 feat: add secure backend admin authentication`
- Backend nested repo P-8 checkpoint: `fb75303 feat: add member accounts and backend security hardening`

## 2. Deployment Rules

- Run Vercel commands only from:
  `C:\Users\lily.deng\Desktop\pinkkkuin_shop`
- Do not deploy from `.backend-product-publish`.
- Storefront Production deploys use Vercel project `pinkkkuin-shop`.
- Confirm `.vercel/project.json` points to project `pinkkkuin-shop` before
  deploy.
- Do not promote Preview to Production unless explicitly approved.
- Do not push `workspace/main` casually. Historically it is GitHub Pages
  Production backend source.
- Backend staging work uses the nested repo branch `backend-staging`.
- Pushing `lily-backend-Code.gs` does not deploy Apps Script. Apps Script
  updates require a separate approved deployment path.

## 3. Member System Status

P-8B through P-8H are completed and rolled out.

- P-8B Auth foundation:
  Supabase Auth SSR, signup/login/logout, forgot password, reset password.
- P-8C Member profile/address:
  `member_profiles`, `member_addresses`, RLS ownership, default address unique
  rule, `/member` profile and address UI.
- P-8D Member order ownership:
  nullable `orders.user_id`, logged-in checkout ownership, guest compatibility,
  member own-order reads.
- P-8E LINE binding:
  LINE Login OAuth, state/PKCE callback validation, verified binding, unbind UI.
- P-8F Member LINE notifications:
  member notification formatter and backend toggles exist. Production defaults
  are safe OFF when settings are missing.
- P-8G Backend member management:
  backend member list/search/pagination/detail, PII masking, disable/re-enable.
- P-8H Security hardening:
  backend audit logs, PII reveal logging, DB-backed rate limit, grants cleanup,
  disabled-session enforcement.

## 4. Production Safety State

- `MEMBER_SIGNUP_ENABLED=false`
- Production signup is temporarily closed.
- Direct `/api/auth/signup` is server-side blocked when signup is disabled.
- Production Email SMTP/domain is not ready yet.
- Production Email remains disabled until an approved sender/domain rollout.
- P-8F member LINE notification missing-setting fallback is all OFF:
  `order_created=false`, `order_cancelled=false`,
  `payment_completed=false`, `order_shipped=false`.
- P-7A admin LINE notification is independent from P-8F member notification
  settings.

## 5. LINE

- LINE Login Channel name: `Pinkkkuin Member`
- Linked LINE Official Account: `官方-小企鵝闆娘`
- Staging callback:
  `https://pinkkkuin-staging.vercel.app/api/member/line/callback`
- Production callback:
  `https://pinkkkuin-shop.vercel.app/api/member/line/callback`
- Do not record LINE Channel Secret, Messaging API access token, or raw LINE
  user IDs in this repo or in chat.

## 6. Migration Status

P-8 migrations applied to both Staging and Production:

- `202609040001_member_profiles_addresses.sql`
- `202609040002_member_order_ownership.sql`
- `202609040003_member_line_accounts.sql`
- `202609040004_member_line_accounts_service_role_grants.sql`
- `202609070001_backend_member_management.sql`
- `202609070002_backend_member_management_service_role_grants.sql`
- `202609070003_backend_member_security_hardening.sql`
- `202609070004_backend_security_rate_limits.sql`

Staging-only parity cleanup:

- `202609080001_staging_grants_parity_cleanup.sql`

Important:

- The first 8 P-8 migrations are applied and verified on both Staging and
  Production.
- `202609080001_staging_grants_parity_cleanup.sql` is Staging-only and must not
  be applied to Production.

## 7. Final DB Parity

Staging and Production Supabase have been verified as MATCH for:

- columns / types / nullable / defaults
- foreign keys
- indexes
- RLS enabled
- policies
- triggers
- table grants
- function execute grants

Known intentional differences are environment/data related, not schema/security
parity differences.

## 8. Final Privilege Matrix

### Tables

`member_profiles`

- authenticated: `INSERT / SELECT / UPDATE`
- service_role: `INSERT / SELECT / UPDATE`

`member_addresses`

- authenticated: `DELETE / INSERT / SELECT / UPDATE`
- service_role: `SELECT`

`member_line_accounts`

- authenticated: `DELETE / SELECT`
- service_role: `DELETE / INSERT / SELECT / UPDATE`

`orders`

- authenticated: `SELECT`
- service_role: `SELECT`

`order_items`

- authenticated: `SELECT`
- service_role: `SELECT`

`backend_security_audit_logs`

- service_role: `INSERT / SELECT` only

`backend_security_rate_limits`

- service_role: `SELECT / INSERT / UPDATE / DELETE` only

### Backend RPC Execute

- `backend_list_members`: service_role only
- `backend_get_member_detail`: service_role only
- `backend_hit_rate_limit`: service_role only

No `TRUNCATE`, `REFERENCES`, or `TRIGGER` grants should exist for anon,
authenticated, or service_role on the scoped member/backend tables.

## 9. Intentional Environment Differences

These differences are expected and are not parity failures:

- Supabase project URL/ref differs between Staging and Production.
- `APP_ENV` and `SUPABASE_ENV` differ by environment.
- LINE Login redirect URI differs by domain.
- `MEMBER_SIGNUP_ENABLED` differs:
  Production is disabled; Staging can be enabled for testing.
- Preview-only email test env can exist in Preview/Staging.
- Production Email sender env can remain missing until formal Email rollout.
- Business/member/order data counts differ.
- Staging shows the STAGING badge; Production must not.

## 10. Recovery Checklist

If Production has an issue, check in this order:

1. Confirm the active deployment ID and alias target.
2. Confirm the deployed commit/checkpoint.
3. Confirm commands are run from
   `C:\Users\lily.deng\Desktop\pinkkkuin_shop`.
4. Confirm Vercel team/scope is `lilys-projects-2a8e834c`.
5. Confirm Vercel project is `pinkkkuin-shop`.
6. Confirm Production Supabase project ref is `rodncaahpiiukakahnxd`.
7. Confirm required env key presence only; do not print values.
8. Confirm `MEMBER_SIGNUP_ENABLED=false` if signup must remain closed.
9. Confirm migration/schema parity before considering any migration action.
10. Confirm RLS, policies, table grants, and function execute grants.
11. Confirm backend unauthenticated APIs return 401.
12. Confirm `/backend` shows login page in Production.
13. Confirm STAGING badge is hidden in Production and visible in Staging.
14. Confirm LINE callback URLs in LINE Developers.
15. Confirm member notification settings are not accidentally enabled.
16. Do not guess or rerun migrations blindly.
17. Do not manually edit business data as a first response.

## 11. Secret Policy

Never put any of the following in this document, repo, commits, terminal output,
or chat:

- API keys
- passwords
- Supabase service role key
- Supabase anon key values
- LINE Channel Secret
- LINE access token
- raw LINE user ID
- session tokens
- cookies
- Resend key
- SMTP passwords

When auditing env, report only `SET`, `MISSING`, `MATCH`, or `MISMATCH`.
