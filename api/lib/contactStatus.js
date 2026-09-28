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
