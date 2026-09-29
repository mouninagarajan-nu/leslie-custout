// Applies supabase/migrations/*.sql (in order) and then supabase/seed.sql to a
// NON-production database. Use it when a dev database isn't built automatically
// by Supabase Branching.
//
//   DEV_DATABASE_URL=postgresql://... npm run db:setup --workspace=api
//   DEV_DATABASE_URL=postgresql://... npm run db:setup --workspace=api -- --no-seed
//
// It deliberately reads DEV_DATABASE_URL (not DATABASE_URL) and refuses the
// production project, so it can't be pointed at production by accident.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PRODUCTION_PROJECT_REFS = ['bxbrrhdjrcnwowtyjozw'];
const SUPABASE_DIR = path.resolve(__dirname, '..', '..', 'supabase');

async function main() {
  const url = process.env.DEV_DATABASE_URL;
  if (!url) {
    console.error('Set DEV_DATABASE_URL to the develop database connection string.');
    process.exit(1);
  }
  if (PRODUCTION_PROJECT_REFS.some((ref) => url.includes(ref))) {
    console.error('Refusing to run: DEV_DATABASE_URL points at the production Supabase project.');
    process.exit(1);
  }

  const migrationsDir = path.join(SUPABASE_DIR, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(migrationsDir, f));
  if (!process.argv.includes('--no-seed')) files.push(path.join(SUPABASE_DIR, 'seed.sql'));

  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of files) {
      process.stdout.write(`Applying ${path.relative(SUPABASE_DIR, file)} … `);
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(file, 'utf8'));
        await client.query('COMMIT');
        console.log('ok');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
