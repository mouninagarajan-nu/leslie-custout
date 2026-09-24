// store_details holds the full store feed (~1,500 locations, incl. warehouses, websites
// and test stores). Store lists only show the ones this app works with: stores that
// appear in store_assignment (as an open or closed store) or have customers.
export const storeInUse = (alias) => `(
  exists (
    select 1 from store_assignment sa
    where sa.open_store = ${alias}.store_nbr or sa.closed_store = ${alias}.store_nbr
  )
  or exists (
    select 1 from customer_assignment ca where ca.store_number = ${alias}.store_nbr
  )
)`;
