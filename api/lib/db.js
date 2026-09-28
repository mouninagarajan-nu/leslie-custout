import { Pool } from 'pg';

const isSsl =
  process.env.DB_SSL === 'true' ||
  process.env.PGSSL === 'true' ||
  process.env.DATABASE_SSL === 'true' ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase'));

const config = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isSsl ? { rejectUnauthorized: false } : undefined
    }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: isSsl ? { rejectUnauthorized: false } : undefined
    };

// Cache pool globally in dev mode to prevent connection leaks during HMR
const pool = global.__custoutPgPool || new Pool(config);

if (process.env.NODE_ENV !== 'production') {
  global.__custoutPgPool = pool;
}

export default pool;
