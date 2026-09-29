// Rebuilds the LOCAL SQL Server database from the Postgres (Supabase) data, for
// comparing the two dialects side by side.
//
//   npm run db:mirror:mssql --workspace=api               # same shape, fake names (default)
//   npm run db:mirror:mssql --workspace=api -- --exact    # exact copy, real values
//
// Reads Postgres (DATABASE_URL) — read-only. Wipes and reloads SQL Server
// (MSSQL_DATABASE_URL), and refuses unless that points at localhost.
//
// --exact copies every row unchanged, INCLUDING customer PII (names, phones,
// notes) — only use it where production personal data is allowed on the machine.
//
// Default (anonymised) — copied as-is: store_details (except store_manager), store_assignment,
// employee IDs/stores/roles/created_at, and claim history (employee, store, date).
// Replaced with fake values: customer names/phones/notes, employee names,
// store manager names. Each customer keeps its real Y/N flags, so per-store
// counts and status mix match. Claims are remapped onto the fake customers.
//
// One record exists ONLY in SQL Server, to tell the databases apart:
// 'Test Customer 887-08' (store 887, unresolved).

// The source is read with plain `pg`, not the Postgres Prisma client: Prisma reads
// every model's primary key, and customer_assignment.id doesn't exist on a database
// that hasn't applied 20260928000000_add_keys_for_prisma yet (e.g. production).
const { Client, types } = require('pg');
const { PrismaClient: MssqlClient } = require('../prisma/generated/mssql');

// pg parses DATE / TIMESTAMP (no zone) in the machine's local timezone, which would
// shift them (IST: a DATE lands on the previous UTC day). Read them as UTC instead.
types.setTypeParser(1082, (s) => new Date(`${s}T00:00:00Z`)); // date
types.setTypeParser(1114, (s) => new Date(`${s.replace(' ', 'T')}Z`)); // timestamp

const EXACT = process.argv.includes('--exact');

const MARKER = {
  customer_name: 'Test Customer 887-08',
  store_number: '887',
  phone_number: '555-0808',
  contacted_to_store: 'N',
  attempted_to_store: 'N',
  do_not_attempt: 'N',
  notes: 'SQL Server-only test record (not in Supabase).'
};

const STORE_COLUMNS = [
  'rtl_loc_id', 'store_nbr', 'store_name', 'address1', 'address2', 'address3', 'address4', 'city', 'state',
  'postal_code', 'country', 'neighborhood', 'county', 'telephone1', 'store_manager', 'email_addr',
  'record_state', 'create_date', 'update_date'
];
const CUSTOMER_COLUMNS = [
  'customer_name', 'store_number', 'phone_number', 'contacted_to_store', 'attempted_to_store',
  'do_not_attempt', 'notes', 'updated_timestamp'
];

function assertLocalTarget() {
  const target = process.env.MSSQL_DATABASE_URL || '';
  const host = (target.match(/^sqlserver:\/\/([^;:\\]+)/) || [])[1] || '';
  if (!['localhost', '127.0.0.1', '(local)', '.'].includes(host.toLowerCase())) {
    throw new Error(`Refusing to run: MSSQL_DATABASE_URL host is "${host}", not localhost. This script wipes the target.`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (Postgres source) is required.');
  assertLocalTarget();

  const url = process.env.DATABASE_URL;
  const pg = new Client({ connectionString: url, ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined });
  const ms = new MssqlClient();
  await pg.connect();

  try {
    // ── Read source (Postgres), read-only ───────────────────────────────
    await pg.query('BEGIN READ ONLY');
    const rows = async (sql) => (await pg.query(sql)).rows;
    const stores = await rows(`select ${STORE_COLUMNS.join(', ')} from store_details order by store_nbr`);
    const pairs = await rows('select open_store, closed_store, updated_timestamp from store_assignment order by 1, 2');
    const employees = await rows('select employee_id, store_number, employee_name, role, created_at from employees order by 1');
    const customers = await rows(`select ${CUSTOMER_COLUMNS.join(', ')} from customer_assignment order by store_number, customer_name, ctid`);
    const claims = await rows('select employee_id, customer_name, store_number, assigned_date, created_at from employee_daily_assignments order by id');
    await pg.query('ROLLBACK');

    // ── Anonymise (skipped with --exact) ────────────────────────────────
    const fakeName = new Map(); // "<store>|<real name>" -> fake name
    const perStore = new Map();
    const storeOffset = new Map();
    const fakeCustomers = customers.map((c) => {
      const n = (perStore.get(c.store_number) || 0) + 1;
      perStore.set(c.store_number, n);
      if (!storeOffset.has(c.store_number)) storeOffset.set(c.store_number, (storeOffset.size + 1) * 1000);
      const customer_name = `Sample Customer ${c.store_number}-${String(n).padStart(3, '0')}`;
      fakeName.set(`${c.store_number}|${c.customer_name}`, customer_name);
      return {
        customer_name,
        store_number: c.store_number,
        phone_number: c.phone_number == null ? null : `555-${String(storeOffset.get(c.store_number) + n).padStart(4, '0')}`,
        contacted_to_store: c.contacted_to_store,
        attempted_to_store: c.attempted_to_store,
        do_not_attempt: c.do_not_attempt,
        notes: c.notes ? 'Sample note.' : null,
        updated_timestamp: c.updated_timestamp
      };
    });

    // Claims whose customer no longer exists can't be remapped; they're dropped.
    const fakeClaims = claims
      .map((a) => ({
        employee_id: a.employee_id,
        customer_name: fakeName.get(`${a.store_number}|${a.customer_name}`),
        store_number: a.store_number,
        assigned_date: a.assigned_date,
        created_at: a.created_at
      }))
      .filter((a) => a.customer_name);

    const targetCustomers = EXACT ? customers : fakeCustomers;
    const targetClaims = EXACT ? claims : fakeClaims;
    const fakeEmployees = employees.map((e) => ({ ...e, employee_name: `Employee ${e.employee_id}` }));
    const targetEmployees = EXACT ? employees : fakeEmployees;
    const fakeStores = stores.map((s) => ({ ...s, store_manager: s.store_manager ? `Manager ${s.store_nbr}` : null }));

    // ── Replace target (SQL Server) in one transaction ──────────────────
    await ms.$transaction(
      async (tx) => {
        await tx.employeeDailyAssignment.deleteMany();
        await tx.customerAssignment.deleteMany();
        await tx.storeAssignment.deleteMany();
        await tx.employee.deleteMany();
        await tx.storeDetails.deleteMany();

        await tx.storeDetails.createMany({ data: EXACT ? stores : fakeStores });
        await tx.storeAssignment.createMany({ data: pairs });
        await tx.employee.createMany({ data: targetEmployees });
        await tx.customerAssignment.createMany({ data: [...targetCustomers, MARKER] });
        await tx.employeeDailyAssignment.createMany({ data: targetClaims });
      },
      { timeout: 120000, maxWait: 10000 }
    );

    console.log(
      `Mirrored to SQL Server (${EXACT ? 'exact copy' : 'anonymised'}): ${stores.length} stores, ${pairs.length} store pairs, ${targetEmployees.length} employees, ` +
        `${targetCustomers.length} customers (+1 marker '${MARKER.customer_name}'), ` +
        `${targetClaims.length}/${claims.length} claims.`
    );
  } finally {
    await Promise.all([pg.end(), ms.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
