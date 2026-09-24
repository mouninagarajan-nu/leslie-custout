import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';
import { corsHeaders } from '../../../../lib/cors';
import { ADMIN_STORE_NUMBER, verifyAdminRequest } from '../../../../lib/adminAuth';
import { storeInUse } from '../../../../lib/stores';

export const dynamic = 'force-dynamic';

const MAX_CONTACT_ROWS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const IS_CONTACTED = `coalesce(contacted_to_store, 'N') = 'Y'`;
const IS_ATTEMPTED = `coalesce(attempted_to_store, 'N') = 'Y'`;
const IS_DNA = `coalesce(do_not_attempt, 'N') = 'Y'`;
const IS_PENDING = `not (${IS_CONTACTED} or ${IS_ATTEMPTED} or ${IS_DNA})`;

// Whitelisted `status` values → SQL predicate on customer_assignment columns.
const STATUS_FILTERS = {
  all: 'true',
  contacted: IS_CONTACTED,
  attempted: IS_ATTEMPTED,
  do_not_attempt: IS_DNA,
  pending: IS_PENDING
};

const METRIC_COLUMNS = `
  count(*)::int as total,
  count(*) filter (where ${IS_CONTACTED})::int as contacted,
  count(*) filter (where ${IS_ATTEMPTED})::int as attempted,
  count(*) filter (where ${IS_DNA})::int as do_not_attempt,
  count(*) filter (where ${IS_PENDING})::int as pending`;

const STORE_COLUMNS = `store_nbr, store_name, address1, address2, city, state, postal_code,
  country, telephone1, store_manager, email_addr`;

// A store matches its own customers (closed store) and those of every closed store
// mapped to it in store_assignment (open store).
const storeMatch = (storeExpr) => `(
  ca.store_number = ${storeExpr}
  or ca.store_number in (select closed_store from store_assignment where open_store = ${storeExpr})
)`;

// A customer is "in range" if it was assigned to an employee on a day within the range.
const dateMatch = (fromParam, toParam) => `(
  ${fromParam}::date is null or exists (
    select 1 from employee_daily_assignments eda
    where eda.customer_name = ca.customer_name
      and eda.store_number = ca.store_number
      and eda.assigned_date between ${fromParam}::date and ${toParam}::date
  )
)`;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// GET /api/admin/dashboard?store=<store_nbr|all>&from=YYYY-MM-DD&to=YYYY-MM-DD&status=<status>
//
// Always returns `metrics` for the selected scope.
//   store=all → also `stores`: every active store with customer assignments, with its details and metrics.
//   store=X   → also `store` (details) and `contacts` for that store.
// `status` (all|contacted|attempted|do_not_attempt|pending) filters `contacts`; with
// store=all, contacts across all stores are returned only when a status is given.
export async function GET(request) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Admin authorization required' }, { status: 401, headers: corsHeaders() });
  }

  const { searchParams } = new URL(request.url);
  const storeParam = searchParams.get('store')?.trim() || '';
  const store = storeParam && storeParam.toLowerCase() !== 'all' ? storeParam : null;
  const status = searchParams.get('status')?.trim() || null;
  let from = searchParams.get('from')?.trim() || null;
  let to = searchParams.get('to')?.trim() || null;

  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400, headers: corsHeaders() });
  }
  from = from || to;
  to = to || from;
  if (from && from > to) {
    return NextResponse.json({ error: '`from` must be on or before `to`' }, { status: 400, headers: corsHeaders() });
  }
  if (status && !STATUS_FILTERS[status]) {
    return NextResponse.json(
      { error: `status must be one of: ${Object.keys(STATUS_FILTERS).join(', ')}` },
      { status: 400, headers: corsHeaders() }
    );
  }

  // $1 = store (null → all), $2/$3 = date range (null → all time)
  const scopedCte = `
    with scoped as (
      select ca.customer_name, ca.store_number, ca.contacted_to_store,
             ca.attempted_to_store, ca.do_not_attempt, ca.notes
      from customer_assignment ca
      where ($1::text is null or ${storeMatch('$1')})
        and ${dateMatch('$2', '$3')}
    )`;
  const params = [store, from, to];

  const metricsQuery = () => pool.query(`${scopedCte} select ${METRIC_COLUMNS} from scoped`, params);

  const storesQuery = () =>
    pool.query(
      `select ${STORE_COLUMNS.split(',').map((c) => `l.${c.trim()}`).join(', ')}, m.*
       from loc_rtl_loc l
       cross join lateral (
         select ${METRIC_COLUMNS}
         from customer_assignment ca
         where ${storeMatch('l.store_nbr')}
           and ${dateMatch('$1', '$2')}
       ) m
       where coalesce(l.record_state, 'ACTIVE') = 'ACTIVE'
         and l.store_nbr <> $3
         and ${storeInUse('l')}
       order by case when l.store_nbr ~ '^[0-9]+$' then l.store_nbr::numeric end, l.store_nbr`,
      [from, to, ADMIN_STORE_NUMBER]
    );

  const storeDetailQuery = () =>
    pool.query(`select ${STORE_COLUMNS} from loc_rtl_loc where store_nbr = $1`, [store]);

  // Latest assignment (within the range, if any) tells the admin who worked each customer.
  const contactsQuery = () =>
    pool.query(
      `${scopedCte}
       select s.customer_name,
              s.store_number as closed_store_number,
              s.contacted_to_store,
              s.attempted_to_store,
              s.do_not_attempt,
              s.notes,
              la.employee_id as assigned_employee_id,
              e.employee_name as assigned_employee_name,
              to_char(la.assigned_date, 'YYYY-MM-DD') as assigned_date
       from scoped s
       left join lateral (
         select eda.employee_id, eda.assigned_date
         from employee_daily_assignments eda
         where eda.customer_name = s.customer_name
           and eda.store_number = s.store_number
           and ($2::date is null or eda.assigned_date between $2::date and $3::date)
         order by eda.assigned_date desc
         limit 1
       ) la on true
       left join employees e on e.employee_id = la.employee_id
       where ${STATUS_FILTERS[status || 'all']}
       order by s.store_number, s.customer_name
       limit ${MAX_CONTACT_ROWS + 1}`,
      params
    );

  const wantContacts = !!store || !!status;

  try {
    const [metricsRes, extraRes, contactsRes] = await Promise.all([
      metricsQuery(),
      store ? storeDetailQuery() : storesQuery(),
      wantContacts ? contactsQuery() : null
    ]);

    const body = { scope: store ? 'store' : 'all', from, to, status, metrics: metricsRes.rows[0] };
    if (store) {
      body.store = extraRes.rows[0] || { store_nbr: store };
    } else {
      body.stores = extraRes.rows;
    }
    if (contactsRes) {
      body.contacts = contactsRes.rows.slice(0, MAX_CONTACT_ROWS);
      body.truncated = contactsRes.rows.length > MAX_CONTACT_ROWS;
    }

    return NextResponse.json(body, { headers: corsHeaders() });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500, headers: corsHeaders() });
  }
}
