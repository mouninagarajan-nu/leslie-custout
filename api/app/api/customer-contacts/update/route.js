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
    const validContacts = contacts.filter((c) => !!c.customer_name);
    let updated = 0;
    if (validContacts.length > 0) {
      // Build a single bulk UPDATE using a VALUES table so the DB only needs
      // one round-trip regardless of how many rows are being updated.
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
      const result = await client.query(
        `update customer_assignment ca
         set contacted_to_store = v.contacted,
             attempted_to_store = v.attempted,
             do_not_attempt     = v.do_not_attempt,
             notes              = v.notes
         from (values ${valuePlaceholders})
           as v(contacted, attempted, do_not_attempt, notes, customer_name)
         where ca.customer_name = v.customer_name
           and ca.store_number in (
             select closed_store from store_assignment where open_store = ${storeParam}
           )`,
        [...flatParams, storeNumber]
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
