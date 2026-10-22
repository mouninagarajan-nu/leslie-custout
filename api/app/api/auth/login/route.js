import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { corsHeaders } from '../../../../lib/cors';
import { signAdminToken } from '../../../../lib/adminAuth';
import { checkEmployee, getStoreByIp } from '../../../../lib/posapi';
import { ADMIN_STORE_NUMBER } from '../../../../lib/stores';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// First hop of x-forwarded-for is the browser's address as seen by our host's proxy.
function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId.trim() : '';

  if (!employeeId) {
    return NextResponse.json(
      { error: 'Employee ID is required' },
      { status: 400, headers: corsHeaders() }
    );
  }

  try {
    // ── Step 1: Validate the employee ID via POSAPI (same as Water Test) ──────
    // Only whether the ID exists matters; the employee's home store is ignored so
    // transferred employees can still log in.
    const posapi = await checkEmployee(employeeId);
    if (!posapi.valid && !posapi.skipped) {
      return NextResponse.json({ error: 'Invalid Employee ID.' }, { status: 401, headers: corsHeaders() });
    }

    // ── Step 2: Role (and fallback validation) from the local employees table ─
    // Employee IDs match case-insensitively. Filtering in JS keeps that identical on
    // both dialects (Prisma's `mode: 'insensitive'` is Postgres-only).
    const employees = await prisma.employee.findMany({
      select: { employee_id: true, employee_name: true, role: true }
    });
    const record = employees.find((e) => e.employee_id.toUpperCase() === employeeId.toUpperCase());

    // POSAPI disabled or unreachable: the local table is the only check left.
    if (posapi.skipped && !record) {
      return NextResponse.json({ error: 'Invalid Employee ID.' }, { status: 401, headers: corsHeaders() });
    }

    const userRole = record?.role ?? 'Employee';
    const isAdmin = userRole === 'Admin';

    // ── Step 3: Store comes from the device's IP via POSAPI ───────────────────
    // POSAPI maps register IPs to stores (fillableforms.dbo.storeRegister). Admins
    // sign in from outside stores and always use the virtual admin store.
    // TODO(VPN): check whether storeRegister holds public or private (10.x/192.168.x)
    // IPs. This reads the IP our host sees; if the table holds private register IPs
    // and the API runs outside the store network, every lookup will miss.
    let storeNumber = ADMIN_STORE_NUMBER;
    if (!isAdmin) {
      const ip = clientIp(request);
      const store = await getStoreByIp(ip);
      if (!store.storeNumber) {
        console.warn(
          `[login] store lookup ${store.reason}: employeeId=${employeeId} ` +
            `x-forwarded-for=${JSON.stringify(request.headers.get('x-forwarded-for'))} ` +
            `x-real-ip=${JSON.stringify(request.headers.get('x-real-ip'))} parsedIp=${ip}`
        );
        return store.reason === 'not_found'
          ? NextResponse.json(
              { error: 'This device is not registered to a store. Please sign in from a store register.' },
              { status: 403, headers: corsHeaders() }
            )
          : NextResponse.json(
              { error: 'Unable to determine your store right now. Please try again shortly.' },
              { status: 503, headers: corsHeaders() }
            );
      }
      storeNumber = store.storeNumber;
    }

    const employeeName =
      posapi.firstName || posapi.lastName
        ? `${posapi.firstName} ${posapi.lastName}`.trim()
        : record?.employee_name || '';
    const canonicalId = record?.employee_id ?? employeeId;
    const adminToken = isAdmin ? signAdminToken(canonicalId) : undefined;

    return NextResponse.json(
      {
        employeeId: canonicalId,
        employeeName,
        storeNumber,
        role: userRole,
        isAdmin,
        ...(adminToken && { adminToken })
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error('Login verification error:', error);
    return NextResponse.json(
      { error: 'Failed to verify employee credentials' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
