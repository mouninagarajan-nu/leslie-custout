import { PrismaClient as PostgresClient } from '../prisma/generated/postgres';
import { PrismaClient as MssqlClient } from '../prisma/generated/mssql';

/**
 * Database access for the whole API. `DB_DIALECT` picks the backend:
 *   postgres (default) — Supabase/Postgres, connection from DATABASE_URL or PG* vars
 *   mssql              — SQL Server, connection from MSSQL_DATABASE_URL
 * Both generated clients expose the same models, so route code is dialect-agnostic.
 *
 * @typedef {'postgres' | 'mssql'} Dialect
 * @typedef {import('../prisma/generated/postgres').PrismaClient} DbClient
 * @typedef {Omit<DbClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>} DbTransaction
 */

const DIALECTS = ['postgres', 'mssql'];

/** @type {Dialect} */
export const dialect = /** @type {Dialect} */ ((process.env.DB_DIALECT || 'postgres').toLowerCase());

if (!DIALECTS.includes(dialect)) {
  throw new Error(`Unsupported DB_DIALECT "${process.env.DB_DIALECT}". Use one of: ${DIALECTS.join(', ')}.`);
}

const isTrue = (value) => value === 'true';

/** Postgres URL from DATABASE_URL or the discrete PG* vars, with the SSL/pooler options the old pg.Pool applied. */
function postgresUrl() {
  let raw = process.env.DATABASE_URL;
  if (!raw) {
    const { PGHOST, PGPORT = '5432', PGUSER = '', PGPASSWORD = '', PGDATABASE = '' } = process.env;
    if (!PGHOST) return undefined;
    raw = `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }

  const url = new URL(raw);
  const ssl =
    isTrue(process.env.DB_SSL) ||
    isTrue(process.env.PGSSL) ||
    isTrue(process.env.DATABASE_SSL) ||
    raw.includes('supabase');
  // Prisma's default for sslmode=require is sslaccept=accept_invalid_certs,
  // i.e. the same as the old `rejectUnauthorized: false`.
  if (ssl && !url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'require');
  // Supabase's transaction pooler (port 6543) is PgBouncer, which can't keep
  // Prisma's prepared statements across transactions.
  if (url.port === '6543' && !url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
  return url.toString();
}

/** @returns {DbClient} */
function createClient() {
  if (dialect === 'mssql') {
    return /** @type {DbClient} */ (/** @type {unknown} */ (new MssqlClient()));
  }
  return new PostgresClient({ datasourceUrl: postgresUrl() });
}

// Cache the client globally in dev mode to prevent connection leaks during HMR
/** @type {DbClient} */
const prisma = global.__custoutPrisma || createClient();

if (process.env.NODE_ENV !== 'production') {
  global.__custoutPrisma = prisma;
}

export default prisma;

const MAX_TRANSACTION_ATTEMPTS = 3;

/**
 * `prisma.$transaction(fn)`, retried when the database aborts it as a deadlock or
 * write conflict (P2034). SQL Server does this when two requests claim the same
 * customers at once, e.g. the contacts page double-fetching on load; Postgres's
 * skipDuplicates absorbs that case, so this rarely fires there.
 *
 * @template T
 * @param {(tx: DbTransaction) => Promise<T>} fn  Must be safe to re-run from scratch.
 * @returns {Promise<T>}
 */
export async function runTransaction(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn);
    } catch (error) {
      if (error?.code !== 'P2034' || attempt >= MAX_TRANSACTION_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt + Math.random() * 50));
    }
  }
}

/**
 * Today's date as stored in DATE columns (UTC midnight), replacing SQL `current_date`.
 * UTC matches Supabase's server timezone, so existing rows line up.
 */
export function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Insert rows, silently skipping any that hit a unique constraint — the portable
 * form of `INSERT ... ON CONFLICT DO NOTHING`. Returns the number inserted.
 *
 * Postgres does it in one statement via `skipDuplicates`. SQL Server doesn't
 * support `skipDuplicates`, so rows go in one at a time and duplicates (P2002)
 * are skipped; a unique violation only fails that statement in SQL Server, so an
 * enclosing transaction stays usable.
 *
 * @template T
 * @param {{ createMany(args: { data: T[], skipDuplicates?: boolean }): Promise<{ count: number }>, create(args: { data: T }): Promise<unknown> }} delegate
 *   A model delegate, e.g. `tx.employeeDailyAssignment`.
 * @param {T[]} data
 * @returns {Promise<number>}
 */
export async function createManyIgnoringDuplicates(delegate, data) {
  if (data.length === 0) return 0;

  if (dialect === 'postgres') {
    const { count } = await delegate.createMany({ data, skipDuplicates: true });
    return count;
  }

  let count = 0;
  for (const row of data) {
    try {
      await delegate.create({ data: row });
      count += 1;
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }
  return count;
}
