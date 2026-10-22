# Leslie's Customer Connect & Support (Customer Outreach Portal)

An internal employee-portal web application for Leslie's store transition management, enabling store managers and employees to track, attempt, and resolve customer contact workflows.

---

## 🏗️ Architecture

The repository is structured as a monorepo with two independent Next.js applications managed via npm workspaces:

- **`frontend/`**: Next.js App Router UI (`http://localhost:3000`)
  - **`/`**: Split-screen Login page with Employee/Admin authentication modes
  - **`/contacts`**: Customer Contacts workflow screen with attempt counts, status tracking badges, masked phone numbers, and interactive notes
  - **`/admin`**: Centralized Admin Dashboard for store performance monitoring, store filters, date range aggregations, and contact detail views
- **`api/`**: Next.js Route Handlers backend (`http://localhost:4000`)
  - **`/api/auth/login`**: Employee ID validation and IP-based store resolution via POSAPI
  - **`/api/customer-contacts`**: Dynamic customer contact fetch & daily assignment queue
  - **`/api/customer-contacts/update`**: Status update handler with automatic "Do Not Attempt" promotion after 3 attempts
  - **`/api/admin/dashboard`**: Authenticated metric aggregation for store operational metrics
  - **`/api/stores`**: Store details lookup filtered by open stores

---

## ⚡ Quick Start & Installation

### Prerequisites
- Node.js 18+
- npm 9+

### Setup

1. **Install dependencies for all workspaces:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   - Copy `api/.env.example` to `api/.env` and update your PostgreSQL connection string:
     ```env
     DATABASE_URL=postgresql://user:password@host:5432/postgres
     DB_SSL=true
     FRONTEND_ORIGIN=http://localhost:3000
     POSAPI_WSDL_URL=https://posapidev.lesl.com/POSApiServices.asmx?WSDL
     # Local dev only: store to use when the IP can't be resolved
     POSAPI_DEFAULT_STORE=
     ```
   - Copy `frontend/.env.example` to `frontend/.env.local`:
     ```env
     NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
     ```

3. **Run Dev Servers:**
   ```bash
   npm run dev
   ```
   *Runs `frontend` on `http://localhost:3000` and `api` on `http://localhost:4000` concurrently.*

---

## 🔑 Authentication (POSAPI)

Login follows the same pattern as Water Test: employees enter only their **Employee ID**, and the store comes from the device they sign in on.

- **Employee ID**: validated with POSAPI `checkPassword` (sent with an empty password; we only check that the employee exists). The employee's home store is not used, so transferred employees can sign in.
- **Store**: POSAPI `getStoreNumber` maps the client IP to a store via `fillableforms.dbo.storeRegister`. An IP that isn't registered gets **403**; if POSAPI can't be reached, login returns **503** and asks the user to retry.
- **Fallback**: if POSAPI is disabled (`POSAPI_ENABLED=false`) or unreachable, the Employee ID must exist in the local `employees` table. The store still can't be resolved without POSAPI unless `POSAPI_DEFAULT_STORE` is set (local dev only, never production).
- **Admin RBAC**: Admin access is governed by the `role` column in the `employees` database table (`Admin` role) and secured using HMAC token authentication. Admins skip the IP lookup and use the virtual admin store (`ADMIN_STORE_NUMBER`, default `9999`).
- **Probe**: `node test-posapi.mjs <employeeId> [ipAddress]` (from `api/`, VPN only) prints the raw POSAPI requests and responses.

---

## 🛠️ Key Commands

```bash
npm install                     # Install all workspace dependencies
npm run dev                      # Run frontend & api dev servers concurrently
npm run build                    # Build both frontend and api production bundles
npm run dev --workspace=frontend # Run frontend app only
npm run dev --workspace=api      # Run API app only
```

---

## 📄 License

Internal tool built for Leslie's Pool Supplies. All rights reserved.
