import { NextResponse } from 'next/server';
import pool from '../../../lib/db';
import { corsHeaders } from '../../../lib/cors';
import { storeInUse } from '../../../lib/stores';

// Exclude the virtual admin store from store lists
const ADMIN_STORE_NUMBER = process.env.ADMIN_STORE_NUMBER || '9999';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// GET /api/stores            → active stores with customer assignments (excluding the virtual admin store)
// GET /api/stores?store=215  → just that store, even if it has no assignments (404 if not found / inactive)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const store = searchParams.get('store')?.trim() || null;

  try {
    const { rows } = await pool.query(
      `select l.store_nbr, l.store_name, l.address1, l.address2, l.city, l.state, l.postal_code,
              l.country, l.telephone1, l.store_manager, l.email_addr
       from store_details l
       ${store ? '' : 'inner join store_assignment sa on trim(sa.open_store) = trim(l.store_nbr)'}
       where coalesce(l.record_state, 'ACTIVE') = 'ACTIVE'
         and l.store_nbr <> $1
         and ($2::text is null or l.store_nbr = $2)
       group by l.store_nbr, l.store_name, l.address1, l.address2, l.city, l.state, l.postal_code,
                l.country, l.telephone1, l.store_manager, l.email_addr
       order by case when l.store_nbr ~ '^[0-9]+$' then l.store_nbr::numeric end, l.store_nbr`,
      [ADMIN_STORE_NUMBER, store]
    );

    if (store) {
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Store not found' }, { status: 404, headers: corsHeaders() });
      }
      return NextResponse.json(rows[0], { headers: corsHeaders() });
    }
    return NextResponse.json(rows, { headers: corsHeaders() });
  } catch (error) {
    console.error('Stores lookup error:', error);
    return NextResponse.json({ error: 'Failed to load stores' }, { status: 500, headers: corsHeaders() });
  }
}
