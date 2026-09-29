import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { corsHeaders } from '../../../../lib/cors';
import { signAdminToken } from '../../../../lib/adminAuth';
import { validateEmployee } from '../../../../lib/xcenter';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId.trim() : '';
  const storeNumber = typeof body?.storeNumber === 'string' ? body.storeNumber.trim() : '';

  if (!employeeId || !storeNumber) {
    return NextResponse.json(
      { error: 'Employee ID and Store Number are required' },
      { status: 400, headers: corsHeaders() }
    );
  }

  try {
    // ── Step 1: Validate employee identity via xCenter SOAP API ──────────────
    const xcenter = await validateEmployee(employeeId);

    if (!xcenter.valid) {
      // If xCenter itself is down, fall back to DB-only validation so the app
      // keeps working during outages. Remove this block if you want strict mode.
      if (xcenter.error === 'xCenter service unavailable') {
        console.warn('[login] xCenter unavailable — falling back to DB validation');
      } else {
        return NextResponse.json(
          { error: 'Invalid Employee ID.' },
          { status: 401, headers: corsHeaders() }
        );
      }
    }

    // ── Step 2: Check store assignment + role in your own DB ─────────────────
    // Employee IDs match case-insensitively. Filtering in JS keeps that identical on
    // both dialects (Prisma's `mode: 'insensitive'` is Postgres-only); a store has
    // only a handful of employees.
    const storeEmployees = await prisma.employee.findMany({
      where: { store_number: storeNumber },
      select: { employee_id: true, employee_name: true, store_number: true, role: true }
    });
    const rows = storeEmployees
      .filter((e) => e.employee_id.toUpperCase() === employeeId.toUpperCase())
      .map((e) => ({ ...e, role: e.role ?? 'Employee' }));

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid Employee ID or Store Number.' },
        { status: 401, headers: corsHeaders() }
      );
    }

    // Use xCenter name if available, fall back to DB name
    const employeeName =
      xcenter.valid && (xcenter.firstName || xcenter.lastName)
        ? `${xcenter.firstName} ${xcenter.lastName}`.trim()
        : rows[0].employee_name;

    const userRole = rows[0].role;
    const isAdmin = userRole === 'Admin';
    const adminToken = isAdmin ? signAdminToken(rows[0].employee_id) : undefined;

    return NextResponse.json(
      {
        employeeId: rows[0].employee_id,
        employeeName,
        storeNumber: rows[0].store_number,
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
