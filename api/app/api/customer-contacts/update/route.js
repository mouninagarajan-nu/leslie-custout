import { NextResponse } from 'next/server';
import { runTransaction } from '../../../../lib/prisma';
import { countsByCustomer, customerKey } from '../../../../lib/contactStatus';
import { corsHeaders } from '../../../../lib/cors';

export const dynamic = 'force-dynamic';

// After this many assignments a customer is automatically closed as Do Not Attempt.
const MAX_ATTEMPTS = 3;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { contacts, storeNumber } = body || {};

  if (!storeNumber) {
    return NextResponse.json({ error: 'storeNumber is required' }, { status: 400, headers: corsHeaders() });
  }
  if (!Array.isArray(contacts)) {
    return NextResponse.json({ error: 'contacts must be an array' }, { status: 400, headers: corsHeaders() });
  }

  try {
    const updated = await runTransaction(async (tx) => {
      // First entry wins if the same customer is sent twice.
      const valuesByName = new Map();
      for (const c of contacts.filter((c) => !!c.customer_name)) {
        const name = String(c.customer_name);
        if (valuesByName.has(name)) continue;
        valuesByName.set(name, {
          contacted_to_store: c.contacted_to_store === 'Y' ? 'Y' : 'N',
          attempted_to_store: c.attempted_to_store === 'Y' ? 'Y' : 'N',
          do_not_attempt: c.do_not_attempt === 'Y' ? 'Y' : 'N',
          notes: typeof c.notes === 'string' ? c.notes.trim() || null : null
        });
      }
      if (valuesByName.size === 0) return 0;

      const closedRows = await tx.storeAssignment.findMany({
        where: { open_store: String(storeNumber) },
        select: { closed_store: true }
      });
      const closedStores = closedRows.map((r) => r.closed_store);
      if (closedStores.length === 0) return 0;

      const names = [...valuesByName.keys()];
      const [targets, attemptGroups] = await Promise.all([
        tx.customerAssignment.findMany({
          where: { customer_name: { in: names }, store_number: { in: closedStores } },
          select: { customer_name: true, store_number: true },
          distinct: ['customer_name', 'store_number']
        }),
        tx.employeeDailyAssignment.groupBy({
          by: ['customer_name', 'store_number'],
          where: { customer_name: { in: names }, store_number: { in: closedStores } },
          _count: { _all: true }
        })
      ]);
      const attemptCounts = countsByCustomer(attemptGroups);

      let count = 0;
      for (const target of targets) {
        const data = { ...valuesByName.get(target.customer_name) };
        // Auto-close rule: if a contact is being saved as "Attempted" (not Contacted)
        // and the total assignment count for that customer has hit MAX_ATTEMPTS,
        // promote it to "Do Not Attempt" instead so the case is closed.
        if (
          data.contacted_to_store === 'N' &&
          data.attempted_to_store === 'Y' &&
          (attemptCounts.get(customerKey(target)) || 0) >= MAX_ATTEMPTS
        ) {
          data.attempted_to_store = 'N';
          data.do_not_attempt = 'Y';
        }
        // Every row with this name at this store, as the old bulk UPDATE did.
        const result = await tx.customerAssignment.updateMany({
          where: { customer_name: target.customer_name, store_number: target.store_number },
          data
        });
        count += result.count;
      }
      return count;
    });

    return NextResponse.json({ message: `Record (${updated}) updated successfully.` }, { headers: corsHeaders() });
  } catch (error) {
    console.error('Update error:', error);
    return NextResponse.json({ error: 'Failed to update contacts' }, { status: 500, headers: corsHeaders() });
  }
}
