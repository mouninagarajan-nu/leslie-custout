# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # installs both workspaces (frontend, api) via npm workspaces
npm run dev       # runs `frontend` (:3000) and `api` (:4000) dev servers concurrently
npm run build     # builds both workspaces
npm run lint      # next lint, frontend workspace only
```

Per-workspace, from the repo root:

```bash
npm run dev --workspace=frontend    # Next.js frontend dev server on :3000
npm run dev --workspace=api         # Next.js API dev server on :4000
npm run build --workspace=frontend
npm run build --workspace=api
```

There is no test suite/framework configured in this repo.

## Architecture

This is a small internal employee-portal app (Leslie's store transition tool), split into two independent Next.js apps in one repo:

- [frontend/](frontend/) — the UI. App Router pages: [frontend/app/page.js](frontend/app/page.js) is the login screen (`/`), [frontend/app/contacts/page.js](frontend/app/contacts/page.js) + [frontend/app/contacts/ContactsClient.js](frontend/app/contacts/ContactsClient.js) is the contacts screen (`/contacts`). Login posts Employee ID + Store No. to the `api` app's `/api/auth/login`; only on a successful (200) response does it navigate to `/contacts?store=...&emp=...` with those values as query params, which `ContactsClient` reads via `useSearchParams` (wrapped in `<Suspense>` in `page.js`, as required by Next.js). There's no session/token afterward — `store`/`emp` are just query params `ContactsClient` trusts, so anyone can still deep-link into `/contacts?store=X` directly; login only gates the entry point, not the contacts API calls themselves. Calls the `api` app over HTTP using `NEXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:4000`), not a same-origin `/api` proxy.
- [api/](api/) — the backend. Next.js Route Handlers only, no UI: [api/app/api/auth/login/route.js](api/app/api/auth/login/route.js) (`POST`; verifies `employeeId` + `storeNumber` against the `employees` table, no password), [api/app/api/customer-contacts/route.js](api/app/api/customer-contacts/route.js) (`GET`) and [api/app/api/customer-contacts/update/route.js](api/app/api/customer-contacts/update/route.js) (`POST`). All are `force-dynamic` (never cached) and set CORS headers via [api/lib/cors.js](api/lib/cors.js), gated by `FRONTEND_ORIGIN`. Shared `pg.Pool` in [api/lib/db.js](api/lib/db.js), cached on `global` in dev to survive hot reload.

These are two separate deployables (e.g. two Vercel projects, one rooted at `frontend/`, one at `api/`), not one Next.js app with API routes. There is only **one** implementation of the contacts query/update logic now — unlike the old Vite+Express+Vercel-functions setup, nothing needs to be kept in sync across backends.

**Data model:** Postgres tables `customer_assignment` (customer_name, phone_number, contacted_to_store, attempted_to_store, do_not_attempt, notes, store_number) and `store_assignment` (open_store → closed_store mapping). Y/N flag columns are stringly-typed; `toBool()` in [ContactsClient.js](frontend/app/contacts/ContactsClient.js) normalizes them for the UI, and the API coerces back to `'Y'`/`'N'` on write. A separate `employees` table (`employee_id` PRIMARY KEY, `store_number`, `employee_name`) backs login — `/api/auth/login` checks the submitted `employee_id` exists with that exact `store_number`; no password, no session/JWT issued.

**Per-employee daily assignment (`employee_daily_assignments` table):** Contacts are assigned per employee per day, not per store. `GET /api/customer-contacts` (requires both `openStore` and `employeeId`) does, inside one transaction: (1) counts how many customers this `employeeId` has already been assigned today (`assigned_date = current_date`) across the open store's closed stores; (2) if under the quota (`DAILY_QUOTA = 2` in [route.js](api/app/api/customer-contacts/route.js)), claims that many more from customers that are both unresolved (`contacted_to_store`/`attempted_to_store`/`do_not_attempt` all `'N'`) and not already claimed by *any* employee today, via `INSERT ... ON CONFLICT (customer_name, store_number, assigned_date) DO NOTHING` — that unique constraint is what stops two employees claiming the same customer same day; (3) returns **every** customer for the store (not just this employee's), each annotated with `is_actionable` (one of this employee's 2 slots today, still unresolved) and `is_completed` (one of this employee's 2 slots today, already resolved by them). The quota is consumed once per day regardless of resolution — resolving one of the 2 does **not** trigger a 3rd assignment; once both are resolved, nothing is `is_actionable` for that employee until tomorrow. A different employee at the same store gets a disjoint pair. `phone_number` is masked server-side (last 4 digits → `xxxx`) for every row that is neither `is_actionable` nor `is_completed` for the requesting employee — the real number for a customer never reaches an employee it isn't assigned to today. `ContactsClient` renders all rows: `is_actionable` rows are fully interactive, `is_completed` rows show a green "Completed" badge with locked checkboxes reflecting their real values, and everything else renders muted/disabled with masked phone and read-only notes. Known simplification: no locking beyond the unique constraint, so two truly concurrent requests for the same employee could theoretically over-assign — not a realistic concern given the login flow.

**Admin dashboard (`/admin`):** Employees whose `store_number` is the virtual admin store (`ADMIN_STORE_NUMBER`, default `9999`) are admins. The login page has an Employee/Admin toggle (Admin pre-fills store 9999). For admins, `/api/auth/login` also returns `adminToken`, an HMAC-signed, 8-hour token from [api/lib/adminAuth.js](api/lib/adminAuth.js) (no new deps; `ADMIN_TOKEN_SECRET` is required in production). The frontend keeps it in `sessionStorage` ([frontend/lib/adminSession.js](frontend/lib/adminSession.js)) and sends it as `Authorization: Bearer` to [api/app/api/admin/dashboard/route.js](api/app/api/admin/dashboard/route.js), which returns 401 without a valid token. That is the **only** token-gated API; the employee flow still has no session. The dashboard takes `store` (`all` or a store number, matched as either an open store via `store_assignment` or a closed store directly), `from`/`to` (`YYYY-MM-DD`), and `status` (`all|contacted|attempted|do_not_attempt|pending`). It always returns `metrics`. With `store=all` it also returns `stores`, every active `loc_rtl_loc` store with its own metrics, which renders as clickable store cards. With a specific store it also returns `store` and `contacts`. Clicking a metric card sets `status`, which filters `contacts`; with `store=all`, contacts are only returned when `status` is set. The date range filters on `employee_daily_assignments.assigned_date`, because `customer_assignment` has no timestamps. Store metadata comes from `loc_rtl_loc` via the public [api/app/api/stores/route.js](api/app/api/stores/route.js) (`?store=X` for one), and the shared [frontend/app/components/StoreHeader.js](frontend/app/components/StoreHeader.js) renders it on both `/contacts` and `/admin`. Schema lives in [supabase/migrations/](supabase/migrations/).

**Database environments:** Production is the Supabase project the `main` deploys use; don't run DDL or seed data against it. The `develop` git branch gets its own database. [supabase/migrations/](supabase/migrations/) holds the full, idempotent schema, and [supabase/seed.sql](supabase/seed.sql) holds **synthetic** dev data (admin: `ADMIN001` / store `9999`; employees `DEV001`–`DEV004`). Supabase Branching applies both automatically to a branch database. To set up a dev database by hand, run `DEV_DATABASE_URL=... npm run db:setup --workspace=api` ([api/scripts/db-setup.js](api/scripts/db-setup.js)); it refuses the production project ref. Add new schema changes as new timestamped files in `supabase/migrations/`.

**Environment variables:**
- `api/` (Postgres connection + CORS): `DATABASE_URL` or the discrete `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`, plus `DB_SSL`/`PGSSL`/`DATABASE_SSL` to toggle SSL (`rejectUnauthorized: false`), `FRONTEND_ORIGIN` (must match the frontend's origin exactly for CORS to pass), `ADMIN_TOKEN_SECRET` and `ADMIN_STORE_NUMBER`. See [api/.env.example](api/.env.example).
- `frontend/`: `NEXT_PUBLIC_API_BASE_URL` — base URL of the `api` app. See [frontend/.env.example](frontend/.env.example).

## Migration note

This repo was migrated from a Vite + React frontend with a duplicated Express/Vercel-serverless-functions backend to the two-app Next.js structure above. The old files (`index.html`, `contacts.html`, `vite.config.js`, `eslintrc.cjs`, `server.js`, `vercel.json`, `src/`, and the old `api/customer-contacts.js` / `api/customer-contacts-update.js`) were intentionally left in place pending explicit removal — see git status / ask before deleting if they're still present.
