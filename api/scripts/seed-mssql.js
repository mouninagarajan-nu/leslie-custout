// SYNTHETIC seed data for a local/dev SQL Server database — the SQL Server
// counterpart of supabase/seed.sql (same stores, employees and fake customers).
// Idempotent: existing rows are left untouched.
//
//   npm run db:deploy:mssql --workspace=api   # create tables first
//   npm run db:seed:mssql --workspace=api
//
// Reads MSSQL_DATABASE_URL (from api/.env).

const { PrismaClient } = require('../prisma/generated/mssql');

const prisma = new PrismaClient();

const STORES = [
  ['LOC-215', '215', 'Dev Store 215', '100 Sample Ave', 'Phoenix', 'AZ', '85001', '555-0100', 'Dev Manager A'],
  ['LOC-216', '216', 'Dev Store 216', '110 Sample Ave', 'Mesa', 'AZ', '85201', '555-0101', 'Dev Manager B'],
  ['LOC-1330', '1330', 'Dev Store 1330', '120 Sample Ave', 'Tempe', 'AZ', '85281', '555-0102', 'Dev Manager C'],
  ['LOC-887', '887', 'Dev Store 887', '200 Example Blvd', 'Tampa', 'FL', '33601', '555-0103', 'Dev Manager D'],
  ['LOC-888', '888', 'Dev Store 888', '210 Example Blvd', 'Clearwater', 'FL', '33755', '555-0104', 'Dev Manager E'],
  ['LOC-997', '997', 'Dev Store 997', '300 Test St', 'Austin', 'TX', '73301', '555-0105', 'Dev Manager F'],
  ['LOC-998', '998', 'Dev Store 998', '310 Test St', 'Round Rock', 'TX', '78664', '555-0106', 'Dev Manager G']
];

// [open_store, closed_store]
const STORE_PAIRS = [
  ['888', '887'],
  ['998', '997'],
  ['216', '1330']
];

// Employees log in with Employee ID + their open store; admins use store 9999.
const EMPLOYEES = [
  ['DEV001', '888', 'Dev Employee One', 'Employee'],
  ['DEV002', '888', 'Dev Employee Two', 'Employee'],
  ['DEV003', '998', 'Dev Employee Three', 'Employee'],
  ['DEV004', '216', 'Dev Employee Four', 'Employee'],
  ['ADMIN001', '9999', 'Dev Admin', 'Admin']
];

// [closed store, phone offset]
const CUSTOMER_STORES = [
  ['887', 1000],
  ['997', 2000],
  ['1330', 3000]
];

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function main() {
  for (const [rtl_loc_id, store_nbr, store_name, address1, city, state, postal_code, telephone1, store_manager] of STORES) {
    await prisma.storeDetails.upsert({
      where: { store_nbr },
      update: {},
      create: {
        rtl_loc_id, store_nbr, store_name, address1, city, state, postal_code, telephone1, store_manager,
        country: 'US',
        email_addr: `store${store_nbr}@example.com`
      }
    });
  }

  for (const [open_store, closed_store] of STORE_PAIRS) {
    await prisma.storeAssignment.upsert({
      where: { open_store_closed_store: { open_store, closed_store } },
      update: {},
      create: { open_store, closed_store }
    });
  }

  for (const [employee_id, store_number, employee_name, role] of EMPLOYEES) {
    await prisma.employee.upsert({
      where: { employee_id },
      update: {},
      create: { employee_id, store_number, employee_name, role }
    });
  }

  // 8 fake customers per closed store; a few pre-resolved so the dashboard has data.
  const resolved = [];
  for (const [store_number, offset] of CUSTOMER_STORES) {
    for (let n = 1; n <= 8; n += 1) {
      const customer = {
        store_number,
        customer_name: `Test Customer ${store_number}-${String(n).padStart(2, '0')}`,
        phone_number: `555-${String(n + offset).padStart(4, '0')}`,
        contacted_to_store: n === 1 ? 'Y' : 'N',
        attempted_to_store: n === 1 || n === 2 ? 'Y' : 'N',
        do_not_attempt: n === 3 ? 'Y' : 'N',
        notes: n === 1 ? 'Sample note: customer will visit the new store.' : null
      };
      await prisma.customerAssignment.upsert({
        where: { customer_name_store_number: { customer_name: customer.customer_name, store_number } },
        update: {},
        create: customer
      });
      if (n <= 3) resolved.push(customer);
    }
  }

  // Today's claims for the pre-resolved customers (first employee of the open store),
  // so date-filtered views aren't empty.
  const assigned_date = todayUtc();
  for (const { customer_name, store_number } of resolved) {
    const [openStore] = STORE_PAIRS.find(([, closed]) => closed === store_number);
    const [employee_id] = EMPLOYEES.filter(([, store]) => store === openStore).map(([id]) => id).sort();
    await prisma.employeeDailyAssignment.upsert({
      where: {
        customer_name_store_number_assigned_date: { customer_name, store_number, assigned_date }
      },
      update: {},
      create: { employee_id, customer_name, store_number, assigned_date }
    });
  }

  console.log('Seeded SQL Server dev data.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
