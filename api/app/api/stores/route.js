import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { corsHeaders } from '../../../lib/cors';
import { ADMIN_STORE_NUMBER, STORE_SELECT, activeStoreWhere, findOpenStores } from '../../../lib/stores';

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
    if (store) {
      const row =
        store === ADMIN_STORE_NUMBER
          ? null
          : await prisma.storeDetails.findFirst({
              where: { ...activeStoreWhere, store_nbr: store },
              select: STORE_SELECT
            });
      if (!row) {
        return NextResponse.json({ error: 'Store not found' }, { status: 404, headers: corsHeaders() });
      }
      return NextResponse.json(row, { headers: corsHeaders() });
    }

    return NextResponse.json(await findOpenStores(prisma), { headers: corsHeaders() });
  } catch (error) {
    console.error('Stores lookup error:', error);
    return NextResponse.json({ error: 'Failed to load stores' }, { status: 500, headers: corsHeaders() });
  }
}
