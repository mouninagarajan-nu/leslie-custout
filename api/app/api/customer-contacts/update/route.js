import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const validContacts = contacts.filter((c) => !!c.customer_name);
    let updated = 0;
    if (validContacts.length > 0) {
      // Build a single bulk UPDATE.
      // Auto-close rule: if a contact is being saved as "Attempted" (not Contacted)
      // and the total assignment count for that customer has hit MAX_ATTEMPTS,
      // promote it to "Do Not Attempt" instead so the case is closed.
      const valuePlaceholders = validContacts
        .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::text, $${i * 5 + 5})`)
        .join(', ');
      const flatParams = validContacts.flatMap((c) => [
        c.contacted_to_store === 'Y' ? 'Y' : 'N',
        c.attempted_to_store === 'Y' ? 'Y' : 'N',
        c.do_not_attempt === 'Y' ? 'Y' : 'N',
        typeof c.notes === 'string' ? c.notes.trim() || null : null,
        c.customer_name,
      ]);
      const storeParam = `$${validContacts.length * 5 + 1}`;
      const maxAttemptsParam = `$${validContacts.length * 5 + 2}`;
      const result = await client.query(
        `update customer_assignment ca
         set contacted_to_store = v.contacted,
             attempted_to_store =
               -- If the row is being saved as Attempted (not Contacted) and has hit the
               -- attempt cap, clear attempted_to_store (DNA will be set below instead).
               case
                 when v.contacted = 'N'
                   and v.attempted = 'Y'
                   and (
                     select count(*)
                     from employee_daily_assignments eda
                     where eda.customer_name = ca.customer_name
                       and eda.store_number  = ca.store_number
                   ) >= ${maxAttemptsParam}::int
                 then 'N'
                 else v.attempted
               end,
             do_not_attempt =
               -- Auto-promote to DNA when attempt cap is reached.
               case
                 when v.contacted = 'N'
                   and v.attempted = 'Y'
                   and (
                     select count(*)
                     from employee_daily_assignments eda
                     where eda.customer_name = ca.customer_name
                       and eda.store_number  = ca.store_number
                   ) >= ${maxAttemptsParam}::int
                 then 'Y'
                 else v.do_not_attempt
               end,
             notes = v.notes
         from (values ${valuePlaceholders})
           as v(contacted, attempted, do_not_attempt, notes, customer_name)
         where ca.customer_name = v.customer_name
           and ca.store_number in (
             select closed_store from store_assignment where open_store = ${storeParam}
           )`,
        [...flatParams, storeNumber, MAX_ATTEMPTS]
      );
      updated = result.rowCount || 0;
    }
    await client.query('COMMIT');
    return NextResponse.json({ message: `Record (${updated}) updated successfully.` }, { headers: corsHeaders() });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update error:', error);
    return NextResponse.json({ error: 'Failed to update contacts' }, { status: 500, headers: corsHeaders() });
  } finally {
    client.release();
  }
}
