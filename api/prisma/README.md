# Database layer (Prisma, Postgres + SQL Server)

The API talks to either PostgreSQL or Microsoft SQL Server, chosen at runtime by
`DB_DIALECT`. Route code imports one client from [`lib/prisma.js`](../lib/prisma.js)
and never sees which database it is.

```
prisma/
  postgres/schema.prisma      provider = "postgresql"  -> generated/postgres
  mssql/schema.prisma         provider = "sqlserver"   -> generated/mssql
  mssql/migrations/           Prisma Migrate history (SQL Server only)
  generated/                  both clients, git-ignored, built by `db:generate`
```

Prisma allows one `provider` per schema, so there are two schema files with the
**same models**. Only the provider, the URL env var and the `@db.*` native types
differ. Any model change must be made in both files.

All five API routes use it; there is no raw SQL in `app/`. The CLI scripts in
`scripts/` (`db-setup`, `import-stores`, `grant_admin`, and the Postgres side of
`mirror-to-mssql`) still use `pg` directly, since they target Postgres itself.

## Deploying (Postgres)

Apply `supabase/migrations/` **before** deploying this code. Prisma reads every
model's primary key, and `customer_assignment.id` only exists after
`20260928000000_add_keys_for_prisma.sql`. Without it, every customer query fails.
`20260929000000_customer_assignment_surrogate_id.sql` converts a database that ran
the first (composite-key) version of that migration.

## Environment

| Variable | Used when | Notes |
| --- | --- | --- |
| `DB_DIALECT` | always | `postgres` (default) or `mssql` |
| `DATABASE_URL` or `PG*` | `postgres` | `sslmode=require` is added when `DB_SSL`/`PGSSL`/`DATABASE_SSL` is `true` or the URL is Supabase. `pgbouncer=true` is added for port 6543 |
| `MSSQL_DATABASE_URL` | `mssql` | `sqlserver://host:1433;database=custout;user=sa;password=[PASSWORD];encrypt=true;trustServerCertificate=true` |

Each schema reads its own URL variable, so `prisma generate` can build both
clients no matter which database the environment points at.

## Generating clients

```bash
npm run db:generate --workspace=api   # both clients; also runs on install and build
```

## Migrations

### PostgreSQL: `supabase/migrations/` owns the schema

Supabase Branching and `npm run db:setup` apply the SQL files in
`supabase/migrations/`. **Do not run `prisma migrate` or `prisma db push` against
Postgres.** To change the schema:

1. Add a timestamped SQL file to `supabase/migrations/`.
2. Update `prisma/postgres/schema.prisma` to match, and mirror the model change in `prisma/mssql/schema.prisma`.
3. Check the two agree (use a direct `:5432` connection, not the 6543 pooler):

   ```bash
   DATABASE_URL=postgresql://... npm run db:check:postgres --workspace=api   # exit 0 = no drift
   ```

### SQL Server: Prisma Migrate owns the schema

```bash
# Dev: create a migration from schema changes and apply it (needs a dev server + shadow DB)
MSSQL_DATABASE_URL=sqlserver://... npm run db:migrate:mssql --workspace=api -- --name <change>

# CI / staging / prod: apply pending migrations only
MSSQL_DATABASE_URL=sqlserver://... npm run db:deploy:mssql --workspace=api
```

Local test data, pick one:

```bash
npm run db:seed:mssql --workspace=api     # synthetic DEV001–DEV004 data (same as supabase/seed.sql)
npm run db:mirror:mssql --workspace=api   # same shape as the DATABASE_URL Postgres data, with fake
                                          # customer/employee names; wipes the target, localhost only
npm run db:mirror:mssql --workspace=api -- --exact   # exact copy, including customer PII
```

After a mirror, `Test Customer 887-08` is the one row that exists only in SQL Server.

Prisma can't express CHECK constraints. The Y/N checks on `customer_assignment`
are hand-written in the init migration. Add any new ones the same way.

## Dialect differences handled in code

- **Insert-if-absent** (`ON CONFLICT DO NOTHING`): use `createManyIgnoringDuplicates()`
  from `lib/prisma.js`. Postgres uses `createMany({ skipDuplicates: true })`.
  SQL Server doesn't support `skipDuplicates`, so it inserts one row at a time
  and skips unique violations (`P2002`).
- **Concurrent claims**: SQL Server runs with `READ_COMMITTED_SNAPSHOT ON` (a
  migration sets it), so readers don't block on uncommitted inserts, like Postgres.
  Without it, simultaneous contacts requests deadlock or hit the 5 s transaction
  timeout. Routes use `runTransaction()`, which retries deadlocks (`P2034`).
- **`current_date`**: use `today()` from `lib/prisma.js` (UTC). Always write
  `assigned_date` explicitly rather than relying on the column default.
- **Customers vs claims**: `customer_assignment` has a surrogate `id`, because
  different customers can share a name at a store. Claims
  (`employee_daily_assignments`) and updates are still matched on
  `(customer_name, store_number)`. That pair isn't unique, so there are no Prisma
  relations: routes load both sides and join them with `customerKey()` from
  `lib/contactStatus.js`. Updates use `updateMany` on the pair, so every row
  sharing a name at a store is updated together, as before.
- **Case-insensitive matching** (login's `UPPER(employee_id)`): filter in JS.
  `mode: 'insensitive'` is Postgres-only.
- **Aggregates** (admin dashboard): load rows with Prisma and count them in JS.
  `FILTER`, `LATERAL` and regex sorting have no portable Prisma form.
- **Ordering**: SQL Server's default collation is case-insensitive and Postgres's
  isn't, so `orderBy: { customer_name }` can order names differently. The same rows
  come back, but on the large store lists their order can differ.
