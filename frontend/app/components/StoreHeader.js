// Store name, address, phone and manager from loc_rtl_loc.
// `store` is a row from GET /api/stores (or the dashboard's `store` field).
export default function StoreHeader({ store, loading = false }) {
  if (loading) {
    return (
      <div className="store-header">
        <span className="skeleton-bar" style={{ width: 220, height: 18, display: 'block' }} />
        <span className="skeleton-bar" style={{ width: 300, height: 13, display: 'block', marginTop: 10 }} />
      </div>
    );
  }
  if (!store) return null;

  const cityLine = [store.city, [store.state, store.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const address = [store.address1, store.address2, cityLine].filter(Boolean).join(', ');

  return (
    <div className="store-header">
      <div className="store-header-title">
        <span className="store-header-badge">
          <i className="fa-solid fa-store" />
          Store {store.store_nbr}
        </span>
        <h2>{store.store_name || `Store ${store.store_nbr}`}</h2>
      </div>
      <div className="store-header-details">
        <span>
          <i className="fa-solid fa-location-dot" />
          {address || 'Address not on file'}
        </span>
        {store.telephone1 && (
          <span>
            <i className="fa-solid fa-phone" />
            {store.telephone1}
          </span>
        )}
        {store.store_manager && (
          <span>
            <i className="fa-solid fa-user-tie" />
            {store.store_manager}
          </span>
        )}
      </div>
    </div>
  );
}
