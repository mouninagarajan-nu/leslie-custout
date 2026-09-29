import { NextResponse } from 'next/server';
import { createManyIgnoringDuplicates, runTransaction, today } from '../../../lib/prisma';
import { countsByCustomer, customerKey, isResolved, unresolvedWhere } from '../../../lib/contactStatus';
import { corsHeaders } from '../../../lib/cors';

export const dynamic = 'force-dynamic';

const DAILY_QUOTA = 2;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const openStore =
    searchParams.get('openStore') || searchParams.get('store') || searchParams.get('storeNumber');
  const employeeId = searchParams.get('employeeId') || searchParams.get('emp');
  const assignNew = searchParams.get('assign') === 'true';

  if (!openStore) {
    return NextResponse.json({ error: 'openStore is required' }, { status: 400, headers: corsHeaders() });
  }
  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required' }, { status: 400, headers: corsHeaders() });
  }

  try {
    const assignedDate = today();

    const { customers, myClaimKeys, attemptCounts } = await runTransaction(async (tx) => {
      const closedRows = await tx.storeAssignment.findMany({
        where: { open_store: openStore },
        select: { closed_store: true }
      });
      const closedStores = closedRows.map((r) => r.closed_store);

      // Today's claims across the open store's closed stores (any employee).
      const claimsToday = () =>
        tx.employeeDailyAssignment.findMany({
          where: { assigned_date: assignedDate, store_number: { in: closedStores } },
          select: { employee_id: true, customer_name: true, store_number: true }
        });

      if (closedStores.length > 0 && assignNew) {
        const claimed = await claimsToday();
        const myKeys = new Set(claimed.filter((a) => a.employee_id === employeeId).map(customerKey));

        // Count only *unresolved* tasks currently assigned to the user today,
        // so they can keep pulling new tasks once they resolve their current ones.
        const unresolved = await tx.customerAssignment.findMany({
          where: { ...unresolvedWhere, store_number: { in: closedStores } },
          select: { customer_name: true, store_number: true },
          orderBy: { customer_name: 'asc' }
        });
        const openCount = unresolved.filter((c) => myKeys.has(customerKey(c))).length;
        const needed = DAILY_QUOTA - openCount;

        if (needed > 0) {
          // Candidates: not yet resolved, and not already claimed by anyone today.
          const claimedKeys = new Set(claimed.map(customerKey));
          const candidates = unresolved.filter((c) => !claimedKeys.has(customerKey(c))).slice(0, needed);

          // Skipping duplicates guards against a race where two requests claim the
          // same customer; the loser's row is silently skipped.
          await createManyIgnoringDuplicates(
            tx.employeeDailyAssignment,
            candidates.map((c) => ({
              employee_id: employeeId,
              customer_name: c.customer_name,
              store_number: c.store_number,
              assigned_date: assignedDate
            }))
          );
        }
      }

      const [customerRows, claimedNow, attemptGroups] = await Promise.all([
        tx.customerAssignment.findMany({
          where: { store_number: { in: closedStores } },
          select: {
            customer_name: true,
            phone_number: true,
            contacted_to_store: true,
            attempted_to_store: true,
            do_not_attempt: true,
            notes: true,
            store_number: true
          },
          orderBy: { customer_name: 'asc' }
        }),
        claimsToday(),
        tx.employeeDailyAssignment.groupBy({
          by: ['customer_name', 'store_number'],
          where: { store_number: { in: closedStores } },
          _count: { _all: true }
        })
      ]);

      return {
        customers: customerRows,
        myClaimKeys: new Set(claimedNow.filter((a) => a.employee_id === employeeId).map(customerKey)),
        attemptCounts: countsByCustomer(attemptGroups)
      };
    });

    const maskPhone = (phone) => {
      const str = String(phone || '');
      if (str.length < 4) return 'xxxx';
      return str.slice(0, -4) + 'xxxx';
    };

    const shaped = customers.map((row) => {
      const isMine = myClaimKeys.has(customerKey(row));
      const resolved = isResolved(row);
      return {
        customer_name: row.customer_name,
        phone_number: isMine ? row.phone_number : maskPhone(row.phone_number),
        contacted_to_store: row.contacted_to_store,
        attempted_to_store: row.attempted_to_store,
        do_not_attempt: row.do_not_attempt,
        notes: row.notes,
        closed_store_number: row.store_number,
        attempt_count: attemptCounts.get(customerKey(row)) || 0,
        is_actionable: isMine && !resolved,
        is_completed: isMine && resolved
      };
    });

    // Sort: actionable first, then completed, then the rest (disabled)
    const sortOrder = (r) => {
      if (r.is_actionable) return 0;
      if (r.is_completed) return 1;
      return 2;
    };
    shaped.sort((a, b) => sortOrder(a) - sortOrder(b));

    // Show: all actionable rows + enough disabled rows to fill up to 6 total
    const actionable = shaped.filter((r) => r.is_actionable);
    const others = shaped.filter((r) => !r.is_actionable);
    const MIN_ROWS = 6;
    const othersToShow = Math.max(MIN_ROWS - actionable.length, 0);
    const result = [...actionable, ...others.slice(0, othersToShow)];

    return NextResponse.json(result, { headers: corsHeaders() });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customer contacts' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
