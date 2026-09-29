// A customer is resolved once any of its Y/N flags is 'Y'. do_not_attempt is
// nullable (NULL counts as 'N'); the other two flags are NOT NULL.

/** @typedef {{ contacted_to_store: string, attempted_to_store: string, do_not_attempt: string | null }} ContactFlags */

/** Prisma `where` for CustomerAssignment rows that are still unresolved. */
export const unresolvedWhere = Object.freeze({
  contacted_to_store: { not: 'Y' },
  attempted_to_store: { not: 'Y' },
  OR: [{ do_not_attempt: null }, { do_not_attempt: { not: 'Y' } }]
});

/** @param {ContactFlags} row */
export const isResolved = (row) =>
  row.contacted_to_store === 'Y' || row.attempted_to_store === 'Y' || row.do_not_attempt === 'Y';

/**
 * Key that links a customer to its claims (employee_daily_assignments): claims and
 * updates are matched on (customer_name, store_number), which isn't unique per row.
 * @param {{ customer_name: string, store_number: string }} row
 */
export const customerKey = (row) => `${row.store_number}\u0000${row.customer_name}`;

/**
 * Claim counts per customerKey, i.e. SQL `count(*)` over employee_daily_assignments
 * for each (customer_name, store_number).
 * @param {{ customer_name: string, store_number: string, _count: { _all: number } }[]} groups  from `groupBy`
 * @returns {Map<string, number>}
 */
export const countsByCustomer = (groups) => new Map(groups.map((g) => [customerKey(g), g._count._all]));
