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
  - **`/api/auth/login`**: Employee authentication & xCenter SOAP identity validation
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
     XCENTER_WSDL_URL=https://posapidev.lesl.com/POSApiServices.asmx?WSDL
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

## 🔑 Authentication & xCenter Integration

- **xCenter SOAP API**: Integrates with Leslie's xCenter POS system (`checkPassword` endpoint) to validate employee identity in real time.
- **Fallback Security**: Includes automatic fallback to internal database validation if the xCenter service is unreachable (e.g., when working off-VPN during local development).
- **Admin RBAC**: Admin access is governed by the `role` column in the `employees` database table (`Admin` role) and secured using HMAC token authentication.

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
