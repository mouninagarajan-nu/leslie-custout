// store_details holds the full store feed (~1,500 locations, incl. warehouses, websites
// and test stores). Store lists only show open stores, i.e. those that appear as
// store_assignment.open_store (whitespace-trimmed), are ACTIVE, and aren't the
// virtual admin store.

/** Virtual admin store, excluded from store lists. */
export const ADMIN_STORE_NUMBER = process.env.ADMIN_STORE_NUMBER || '9999';

/** Columns returned for a store by /api/stores and the admin dashboard. */
export const STORE_SELECT = Object.freeze({
  store_nbr: true,
  store_name: true,
  address1: true,
  address2: true,
  city: true,
  state: true,
  postal_code: true,
  country: true,
  telephone1: true,
  store_manager: true,
  email_addr: true
});

/** Prisma `where` for stores that are ACTIVE (NULL record_state counts as ACTIVE). */
export const activeStoreWhere = Object.freeze({
  OR: [{ record_state: null }, { record_state: 'ACTIVE' }]
});

const isNumeric = (s) => /^[0-9]+$/.test(s);

/**
 * Order stores numerically by store_nbr, non-numeric ones last — the old SQL
 * `order by case when store_nbr ~ '^[0-9]+$' then store_nbr::numeric end, store_nbr`.
 * Input must already be ordered by store_nbr in the database (its collation breaks
 * ties); the sort is stable, so that order is kept.
 * @template {{ store_nbr: string }} T
 * @param {T[]} stores
 * @returns {T[]}
 */
export function sortStores(stores) {
  return [...stores].sort((a, b) => {
    const an = isNumeric(a.store_nbr);
    const bn = isNumeric(b.store_nbr);
    if (an && bn) {
      const diff = BigInt(a.store_nbr) - BigInt(b.store_nbr);
      return diff === 0n ? 0 : diff < 0n ? -1 : 1;
    }
    return an === bn ? 0 : an ? -1 : 1;
  });
}

/**
 * Active open stores (store_assignment.open_store, trimmed), excluding the admin store.
 * @param {import('./prisma').DbTransaction} db
 * @returns {Promise<Array<Record<keyof typeof STORE_SELECT, string | null>>>}
 */
export async function findOpenStores(db) {
  const pairs = await db.storeAssignment.findMany({ select: { open_store: true } });
  const openStores = new Set(pairs.map((p) => p.open_store.trim()));
  if (openStores.size === 0) return [];

  // Match on trimmed values like the old `trim(open_store) = trim(store_nbr)` join:
  // query both spellings, then compare trimmed.
  const candidates = await db.storeDetails.findMany({
    where: {
      ...activeStoreWhere,
      store_nbr: { in: [...new Set([...openStores, ...pairs.map((p) => p.open_store)])], not: ADMIN_STORE_NUMBER }
    },
    select: STORE_SELECT,
    orderBy: { store_nbr: 'asc' }
  });
  return sortStores(candidates.filter((s) => openStores.has(s.store_nbr.trim())));
}
