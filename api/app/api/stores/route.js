import { NextResponse } from 'next/server';
import pool from '../../../lib/db';
import { corsHeaders } from '../../../lib/cors';
import { ADMIN_STORE_NUMBER } from '../../../lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// GET /api/stores            → all active stores (excluding the virtual admin store)
// GET /api/stores?store=215  → just that store (404 if not found / inactive)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const store = searchParams.get('store')?.trim() || null;

  try {
    const { rows } = await pool.query(
      `select store_nbr, store_name, address1, address2, city, state, postal_code,
              country, telephone1, store_manager, email_addr
       from loc_rtl_loc
       where coalesce(record_state, 'ACTIVE') = 'ACTIVE'
         and store_nbr <> $1
         and ($2::text is null or store_nbr = $2)
       order by case when store_nbr ~ '^[0-9]+$' then store_nbr::numeric end, store_nbr`,
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
