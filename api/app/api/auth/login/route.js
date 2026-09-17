import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';
import { corsHeaders } from '../../../../lib/cors';

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
    const { rows } = await pool.query(
      `select employee_id, employee_name, store_number
       from employees
       where UPPER(employee_id) = UPPER($1) and store_number = $2`,
      [employeeId, storeNumber]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid Employee ID or Store Number.' },
        { status: 401, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        employeeId: rows[0].employee_id,
        employeeName: rows[0].employee_name,
        storeNumber: rows[0].store_number
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
