import { NextResponse } from 'next/server';
import pool from '../../../lib/db';
import { corsHeaders } from '../../../lib/cors';

export const dynamic = 'force-dynamic';

const DAILY_QUOTA = 2;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const openStore =
    searchParams.get('openStore') || searchParams.get('store') || searchParams.get('storeNumber');
  const employeeId = searchParams.get('employeeId') || searchParams.get('emp');
  const assignNew = searchParams.get('assign') === 'true';

  if (!openStore) {
    return NextResponse.json({ error: 'openStore is required' }, { status: 400, headers: corsHeaders() });
  }
  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required' }, { status: 400, headers: corsHeaders() });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: closedRows } = await client.query(
      `select closed_store from store_assignment where open_store = $1`,
      [openStore]
    );
    const closedStores = closedRows.map((r) => r.closed_store);

    if (closedStores.length > 0 && assignNew) {
      // Count only *unresolved* tasks currently assigned to the user today,
      // so they can keep pulling new tasks once they resolve their current ones.
      const { rows: countRows } = await client.query(
        `select count(*)::int as count
         from employee_daily_assignments eda
         join customer_assignment ca 
           on ca.customer_name = eda.customer_name 
          and ca.store_number = eda.store_number
         where eda.employee_id = $1 
           and eda.assigned_date = current_date 
           and eda.store_number = any($2::text[])
           and coalesce(ca.contacted_to_store, 'N') <> 'Y'
           and coalesce(ca.attempted_to_store, 'N') <> 'Y'
           and coalesce(ca.do_not_attempt, 'N') <> 'Y'`,
        [employeeId, closedStores]
      );
      const needed = DAILY_QUOTA - countRows[0].count;

      if (needed > 0) {
        // Candidates: not yet resolved, and not already claimed by anyone today.
        const { rows: candidates } = await client.query(
          `select ca.customer_name, ca.store_number
           from customer_assignment ca
           where ca.store_number = any($1::text[])
             and coalesce(ca.contacted_to_store, 'N') <> 'Y'
             and coalesce(ca.attempted_to_store, 'N') <> 'Y'
             and coalesce(ca.do_not_attempt, 'N') <> 'Y'
             and not exists (
               select 1 from employee_daily_assignments eda
               where eda.customer_name = ca.customer_name
                 and eda.store_number = ca.store_number
                 and eda.assigned_date = current_date
             )
           order by ca.customer_name
           limit $2`,
          [closedStores, needed]
        );

        if (candidates.length > 0) {
          // Bulk-insert all candidates in a single round-trip.
          // ON CONFLICT guards against a race where two requests claim the same customer;
          // the loser's row is silently skipped.
          const valuePlaceholders = candidates
            .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
            .join(', ');
          const flatParams = [
            employeeId,
            ...candidates.flatMap((c) => [c.customer_name, c.store_number]),
          ];
          await client.query(
            `insert into employee_daily_assignments (employee_id, customer_name, store_number)
             values ${valuePlaceholders}
             on conflict (customer_name, store_number, assigned_date) do nothing`,
            flatParams
          );
        }
      }
    }

    const { rows } = await client.query(
      `select ca.customer_name,
              ca.phone_number,
              ca.contacted_to_store,
              ca.attempted_to_store,
              ca.do_not_attempt,
              ca.notes,
              ca.store_number as closed_store_number,
              (eda.id is not null) as is_mine_today,
              (
                coalesce(ca.contacted_to_store, 'N') = 'Y'
                or coalesce(ca.attempted_to_store, 'N') = 'Y'
                or coalesce(ca.do_not_attempt, 'N') = 'Y'
              ) as is_resolved,
              (
                select count(*)::int
                from employee_daily_assignments eda2
                where eda2.customer_name = ca.customer_name
                  and eda2.store_number = ca.store_number
              ) as attempt_count
       from customer_assignment ca
       left join employee_daily_assignments eda
         on eda.customer_name = ca.customer_name
        and eda.store_number = ca.store_number
        and eda.employee_id = $1
        and eda.assigned_date = current_date
       where ca.store_number = any($2::text[])
       order by ca.customer_name`,
      [employeeId, closedStores]
    );

    const maskPhone = (phone) => {
      const str = String(phone || '');
      if (str.length < 4) return 'xxxx';
      return str.slice(0, -4) + 'xxxx';
    };

    const shaped = rows.map((row) => {
      const isMine = row.is_mine_today;
      const isCompleted = isMine && row.is_resolved;
      const isActionable = isMine && !row.is_resolved;
      const { is_mine_today, is_resolved, ...rest } = row;
      return {
        ...rest,
        phone_number: isMine ? rest.phone_number : maskPhone(rest.phone_number),
        is_actionable: isActionable,
        is_completed: isCompleted
      };
    });

    // Sort: actionable first, then completed, then the rest (disabled)
    const sortOrder = (r) => {
      if (r.is_actionable) return 0;
      if (r.is_completed) return 1;
      return 2;
    };
    shaped.sort((a, b) => sortOrder(a) - sortOrder(b));

    // Show: all actionable rows + enough disabled rows to fill up to 6 total
    const actionable = shaped.filter((r) => r.is_actionable);
    const others = shaped.filter((r) => !r.is_actionable);
    const MIN_ROWS = 6;
    const othersToShow = Math.max(MIN_ROWS - actionable.length, 0);
    const result = [...actionable, ...others.slice(0, othersToShow)];

    await client.query('COMMIT');
    return NextResponse.json(result, { headers: corsHeaders() });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customer contacts' },
      { status: 500, headers: corsHeaders() }
    );
  } finally {
    client.release();
  }
}
