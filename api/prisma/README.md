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

Prisma can't express CHECK constraints. The Y/N checks on `customer_assignment`
are hand-written in the init migration. Add any new ones the same way.

## Dialect differences handled in code

- **Insert-if-absent** (`ON CONFLICT DO NOTHING`): use `createManyIgnoringDuplicates()`
  from `lib/prisma.js`. Postgres uses `createMany({ skipDuplicates: true })`.
  SQL Server doesn't support `skipDuplicates`, so it inserts one row at a time
  and skips unique violations (`P2002`).
- **`current_date`**: use `today()` from `lib/prisma.js` (UTC). Always write
  `assigned_date` explicitly rather than relying on the column default.
- **Relations**: there are no foreign keys in the database. `relationMode = "prisma"`
  lets queries use relation filters (`some`/`none`/`is`) and `_count`. Don't
  `include` `EmployeeDailyAssignment.customer`: the relation is required, and old
  rows may have no matching customer.
- **Ordering**: SQL Server's default collation is case-insensitive and Postgres's
  isn't, so `orderBy: { customer_name }` can order mixed-case names differently.
