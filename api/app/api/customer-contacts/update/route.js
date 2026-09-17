import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';
import { corsHeaders } from '../../../../lib/cors';

export const dynamic = 'force-dynamic';

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
    let updated = 0;
    for (const contact of contacts) {
      if (!contact.customer_name) continue;
      const contacted = contact.contacted_to_store === 'Y' ? 'Y' : 'N';
      const attempted = contact.attempted_to_store === 'Y' ? 'Y' : 'N';
      const doNotAttempt = contact.do_not_attempt === 'Y' ? 'Y' : 'N';
      const notes = typeof contact.notes === 'string' ? contact.notes.trim() : '';
      const result = await client.query(
        `
          update customer_assignment
          set contacted_to_store = $1,
              attempted_to_store = $2,
              do_not_attempt = $3,
              notes = $4
          where customer_name = $5
            and store_number in (
              select closed_store
              from store_assignment
              where open_store = $6
            )
        `,
        [contacted, attempted, doNotAttempt, notes || null, contact.customer_name, storeNumber]
      );
      updated += result.rowCount || 0;
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
