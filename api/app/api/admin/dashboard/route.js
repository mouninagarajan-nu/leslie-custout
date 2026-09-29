import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { corsHeaders } from '../../../../lib/cors';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { customerKey } from '../../../../lib/contactStatus';
import { STORE_SELECT, findOpenStores } from '../../../../lib/stores';

export const dynamic = 'force-dynamic';

const MAX_CONTACT_ROWS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isContacted = (r) => r.contacted_to_store === 'Y';
const isAttempted = (r) => r.attempted_to_store === 'Y';
const isDna = (r) => r.do_not_attempt === 'Y';
const isPending = (r) => !(isContacted(r) || isAttempted(r) || isDna(r));

// Whitelisted `status` values → predicate on customer_assignment rows.
const STATUS_FILTERS = {
  all: () => true,
  contacted: isContacted,
  attempted: isAttempted,
  do_not_attempt: isDna,
  pending: isPending
};

const count = (rows, predicate) => rows.reduce((n, r) => n + (predicate(r) ? 1 : 0), 0);

const metricsOf = (rows) => ({
  total: rows.length,
  contacted: count(rows, isContacted),
  attempted: count(rows, isAttempted),
  do_not_attempt: count(rows, isDna),
  pending: count(rows, isPending)
});

/** DATE column value → 'YYYY-MM-DD' */
const toDateString = (date) => date.toISOString().slice(0, 10);

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

  const wantContacts = !!store || !!status;
  const inRange = (dateString) => !from || (dateString >= from && dateString <= to);

  try {
    const pairs = await prisma.storeAssignment.findMany({ select: { open_store: true, closed_store: true } });
    const closedOf = (openStore) => pairs.filter((p) => p.open_store === openStore).map((p) => p.closed_store);
    // A store matches its own customers (closed store) and those of every closed store
    // mapped to it in store_assignment (open store).
    const storesMatching = (storeNbr) => new Set([storeNbr, ...closedOf(storeNbr)]);

    const [storeDetail, openStores] = await Promise.all([
      store ? prisma.storeDetails.findFirst({ where: { store_nbr: store }, select: STORE_SELECT }) : null,
      store ? null : findOpenStores(prisma)
    ]);

    // Scope: one store (and its closed stores), or — for store=all — only customers of
    // stores in store_assignment, so purely closed-only stores are excluded.
    const scopeStores = store
      ? storesMatching(store)
      : new Set(pairs.flatMap((p) => [p.open_store, p.closed_store]));
    const fetchStores = new Set([...scopeStores, ...(openStores || []).map((s) => s.store_nbr)]);

    const [customers, claims] = await Promise.all([
      prisma.customerAssignment.findMany({
        where: { store_number: { in: [...fetchStores] } },
        select: {
          customer_name: true,
          store_number: true,
          contacted_to_store: true,
          attempted_to_store: true,
          do_not_attempt: true,
          notes: true
        },
        orderBy: [{ store_number: 'asc' }, { customer_name: 'asc' }]
      }),
      prisma.employeeDailyAssignment.findMany({
        where: { store_number: { in: [...fetchStores] } },
        select: { employee_id: true, customer_name: true, store_number: true, assigned_date: true }
      })
    ]);

    // Per customer: total claims, whether any claim falls in the date range, and the
    // latest claim within the range (or overall, with no range).
    const claimInfo = new Map();
    for (const claim of claims) {
      const key = customerKey(claim);
      const info = claimInfo.get(key) || { attempts: 0, inRange: false, latest: null };
      const date = toDateString(claim.assigned_date);
      info.attempts += 1;
      if (inRange(date)) {
        info.inRange = true;
        if (!info.latest || date > info.latest.assigned_date) {
          info.latest = { employee_id: claim.employee_id, assigned_date: date };
        }
      }
      claimInfo.set(key, info);
    }
    // A customer is "in range" if it was assigned to an employee on a day within the range.
    const dateOk = (c) => !from || !!claimInfo.get(customerKey(c))?.inRange;

    const scoped = customers.filter((c) => scopeStores.has(c.store_number) && dateOk(c));
    const body = { scope: store ? 'store' : 'all', from, to, status, metrics: metricsOf(scoped) };

    if (store) {
      body.store = storeDetail || { store_nbr: store };
    } else {
      body.stores = openStores.map((s) => {
        const matching = storesMatching(s.store_nbr);
        return { ...s, ...metricsOf(customers.filter((c) => matching.has(c.store_number) && dateOk(c))) };
      });
    }

    if (wantContacts) {
      const rows = scoped.filter(STATUS_FILTERS[status || 'all']).slice(0, MAX_CONTACT_ROWS + 1);
      const employeeIds = [
        ...new Set(rows.map((r) => claimInfo.get(customerKey(r))?.latest?.employee_id).filter(Boolean))
      ];
      const employees = employeeIds.length
        ? await prisma.employee.findMany({
            where: { employee_id: { in: employeeIds } },
            select: { employee_id: true, employee_name: true }
          })
        : [];
      const nameById = new Map(employees.map((e) => [e.employee_id, e.employee_name]));

      // Latest assignment (within the range, if any) tells the admin who worked each customer.
      const contacts = rows.map((r) => {
        const info = claimInfo.get(customerKey(r));
        const latest = info?.latest;
        return {
          customer_name: r.customer_name,
          closed_store_number: r.store_number,
          contacted_to_store: r.contacted_to_store,
          attempted_to_store: r.attempted_to_store,
          do_not_attempt: r.do_not_attempt,
          notes: r.notes,
          assigned_employee_id: latest?.employee_id ?? null,
          assigned_employee_name: latest ? nameById.get(latest.employee_id) ?? null : null,
          assigned_date: latest?.assigned_date ?? null,
          attempt_count: info?.attempts ?? 0
        };
      });
      body.contacts = contacts.slice(0, MAX_CONTACT_ROWS);
      body.truncated = contacts.length > MAX_CONTACT_ROWS;
    }

    return NextResponse.json(body, { headers: corsHeaders() });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500, headers: corsHeaders() });
  }
}
