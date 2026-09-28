import { NextResponse } from 'next/server';
import prisma, { createManyIgnoringDuplicates, today } from '../../../lib/prisma';
import { isResolved, unresolvedWhere } from '../../../lib/contactStatus';
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

    const rows = await prisma.$transaction(async (tx) => {
      const closedRows = await tx.storeAssignment.findMany({
        where: { open_store: openStore },
        select: { closed_store: true }
      });
      const closedStores = closedRows.map((r) => r.closed_store);

      if (closedStores.length > 0 && assignNew) {
        // Count only *unresolved* tasks currently assigned to the user today,
        // so they can keep pulling new tasks once they resolve their current ones.
        const openCount = await tx.employeeDailyAssignment.count({
          where: {
            employee_id: employeeId,
            assigned_date: assignedDate,
            store_number: { in: closedStores },
            customer: { is: unresolvedWhere }
          }
        });
        const needed = DAILY_QUOTA - openCount;

        if (needed > 0) {
          // Candidates: not yet resolved, and not already claimed by anyone today.
          const candidates = await tx.customerAssignment.findMany({
            where: {
              ...unresolvedWhere,
              store_number: { in: closedStores },
              assignments: { none: { assigned_date: assignedDate } }
            },
            select: { customer_name: true, store_number: true },
            orderBy: { customer_name: 'asc' },
            take: needed
          });

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

      return tx.customerAssignment.findMany({
        where: { store_number: { in: closedStores } },
        select: {
          customer_name: true,
          phone_number: true,
          contacted_to_store: true,
          attempted_to_store: true,
          do_not_attempt: true,
          notes: true,
          store_number: true,
          // This employee's claim on the customer today, if any.
          assignments: {
            where: { employee_id: employeeId, assigned_date: assignedDate },
            select: { id: true },
            take: 1
          },
          _count: { select: { assignments: true } }
        },
        orderBy: { customer_name: 'asc' }
      });
    });

    const maskPhone = (phone) => {
      const str = String(phone || '');
      if (str.length < 4) return 'xxxx';
      return str.slice(0, -4) + 'xxxx';
    };

    const shaped = rows.map((row) => {
      const isMine = row.assignments.length > 0;
      const resolved = isResolved(row);
      return {
        customer_name: row.customer_name,
        phone_number: isMine ? row.phone_number : maskPhone(row.phone_number),
        contacted_to_store: row.contacted_to_store,
        attempted_to_store: row.attempted_to_store,
        do_not_attempt: row.do_not_attempt,
        notes: row.notes,
        closed_store_number: row.store_number,
        attempt_count: row._count.assignments,
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
