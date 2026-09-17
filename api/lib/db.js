import { Pool } from 'pg';

// Cache the pool on `global` so dev-mode hot reload doesn't leak connections.
const pool =
  global.__custoutPgPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl:
      process.env.DB_SSL === 'true' ||
      process.env.PGSSL === 'true' ||
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined
  });

if (process.env.NODE_ENV !== 'production') {
  global.__custoutPgPool = pool;
}

export default pool;
