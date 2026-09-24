'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import StoreHeader from '../components/StoreHeader';
import { clearAdminSession, loadAdminSession } from '../../lib/adminSession';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Past 7 days' },
  { value: '30d', label: 'Past 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' }
];

const toBool = (value) => {
  const str = String(value ?? '').trim().toLowerCase();
  return value === true || str === 'y' || str === 'yes' || str === 'true' || str === '1';
};

// Local-time YYYY-MM-DD (toISOString would shift the day for non-UTC users).
const toISODate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

// Returns { from, to } for the API, or null when a custom range is incomplete.
const resolveRange = (preset, custom) => {
  switch (preset) {
    case 'today':
      return { from: daysAgo(0), to: daysAgo(0) };
    case '7d':
      return { from: daysAgo(6), to: daysAgo(0) };
    case '30d':
      return { from: daysAgo(29), to: daysAgo(0) };
    case 'custom':
      return custom.from && custom.to ? { from: custom.from, to: custom.to } : null;
    default:
      return { from: '', to: '' };
  }
};

// `key` is the metrics field; `status` is the API filter it drills into.
const METRIC_CARDS = [
  { key: 'total', status: 'all', label: 'Customers', icon: 'fa-users', tone: 'primary' },
  { key: 'contacted', status: 'contacted', label: 'Contacted', icon: 'fa-phone-volume', tone: 'success' },
  { key: 'attempted', status: 'attempted', label: 'Attempted', icon: 'fa-phone', tone: 'info' },
  { key: 'do_not_attempt', status: 'do_not_attempt', label: 'Do Not Attempt', icon: 'fa-ban', tone: 'danger' },
  { key: 'pending', status: 'pending', label: 'Pending', icon: 'fa-hourglass-half', tone: 'neutral' }
];

const STATUS_LABELS = Object.fromEntries(
  METRIC_CARDS.map((c) => [c.status, c.status === 'all' ? 'All Customers' : c.label])
);

const formatAddress = (s) => {
  const cityLine = [s.city, [s.state, s.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [s.address1, s.address2, cityLine].filter(Boolean).join(', ');
};

function StoreCard({ store, onSelect }) {
  const resolved = store.total - store.pending;
  const pct = store.total > 0 ? Math.round((resolved / store.total) * 100) : 0;
  return (
    <button type="button" className="store-card" onClick={() => onSelect(store.store_nbr)}>
      <div className="store-card-top">
        <span className="store-header-badge">
          <i className="fa-solid fa-store" />
          Store {store.store_nbr}
        </span>
        <i className="fa-solid fa-chevron-right store-card-arrow" />
      </div>
      <div className="store-card-name">{store.store_name || `Store ${store.store_nbr}`}</div>
      <div className="store-card-details">
        <span><i className="fa-solid fa-location-dot" />{formatAddress(store) || 'Address not on file'}</span>
        {store.telephone1 && <span><i className="fa-solid fa-phone" />{store.telephone1}</span>}
        {store.store_manager && <span><i className="fa-solid fa-user-tie" />{store.store_manager}</span>}
      </div>
      <div className="store-card-stats">
        <div><strong>{store.contacted}</strong><span>Contacted</span></div>
        <div><strong>{store.attempted}</strong><span>Attempted</span></div>
        <div><strong>{store.do_not_attempt}</strong><span>Do Not Attempt</span></div>
        <div><strong>{store.pending}</strong><span>Pending</span></div>
      </div>
      <div className="store-card-progress" title={`${resolved} of ${store.total} resolved`}>
        <div className="store-card-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="store-card-progress-label">
        {resolved.toLocaleString()} of {store.total.toLocaleString()} resolved · {pct}%
      </div>
    </button>
  );
}

function StatusPills({ contact }) {
  const pills = [];
  if (toBool(contact.contacted_to_store)) pills.push(['success', 'Contacted']);
  if (toBool(contact.attempted_to_store) && !toBool(contact.contacted_to_store)) pills.push(['info', 'Attempted']);
  if (toBool(contact.do_not_attempt)) pills.push(['danger', 'Do Not Attempt']);
  if (pills.length === 0) pills.push(['neutral', 'Pending']);
  return (
    <div className="status-pills">
      {pills.map(([tone, label]) => (
        <span key={label} className={`status-pill ${tone}`}>{label}</span>
      ))}
    </div>
  );
}

export default function AdminClient() {
  const router = useRouter();
  const [session, setSession] = useState(null);

  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('all');
  // null → no drill-down (All Stores hides the table; a store shows all its customers)
  const [statusFilter, setStatusFilter] = useState(null);
  const [datePreset, setDatePreset] = useState('7d');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });

  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: false, error: '' });
  // Only the latest request may update state, so fast filter changes can't show stale results.
  const requestSeq = useRef(0);
  const tableRef = useRef(null);

  const logout = useCallback(() => {
    clearAdminSession();
    router.replace('/');
  }, [router]);

  // Session is read client-side only, after mount, to keep SSR/hydration consistent.
  useEffect(() => {
    const s = loadAdminSession();
    if (!s?.token) {
      router.replace('/');
      return;
    }
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    fetch(`${API_BASE}/api/stores`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => setStores(Array.isArray(rows) ? rows : []))
      .catch(() => setStores([]));
  }, [session]);

  const range = useMemo(() => resolveRange(datePreset, customRange), [datePreset, customRange]);

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    const seq = ++requestSeq.current;
    if (!range) {
      setData(null);
      setState({ loading: false, error: '' });
      return;
    }
    setState({ loading: true, error: '' });
    try {
      const params = new URLSearchParams({ store: storeFilter });
      if (statusFilter) params.set('status', statusFilter);
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      const response = await fetch(`${API_BASE}/api/admin/dashboard?${params}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.token}` }
      });
      if (seq !== requestSeq.current) return;
      if (response.status === 401) {
        logout();
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (seq !== requestSeq.current) return;
      if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
      setData(body);
      setState({ loading: false, error: '' });
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setState({ loading: false, error: error.message || 'Unable to load dashboard.' });
    }
  }, [session, storeFilter, statusFilter, range, logout]);

  useEffect(() => {
    // Trap browser back button while logged in as admin to prevent navigating back to login page
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Bring the table into view when a metric card is clicked.
  useEffect(() => {
    if (statusFilter && tableRef.current) {
      tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [statusFilter]);

  const selectStore = (storeNbr) => {
    setStoreFilter(storeNbr);
    setStatusFilter(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleStatus = (status) => {
    setStatusFilter((prev) => (prev === status ? null : status));
  };

  const isStoreView = storeFilter !== 'all';
  const activeStatus = statusFilter || (isStoreView ? 'all' : null);
  const showTable = isStoreView || !!statusFilter;
  // Keep the previous numbers on screen while refreshing the same scope; show
  // skeletons only when the loaded data belongs to a different store.
  const dataScope = data ? (data.scope === 'all' ? 'all' : data.store?.store_nbr) : null;
  const isStale = dataScope !== storeFilter;
  const metrics = isStale ? null : data?.metrics;
  const contacts = !isStale && Array.isArray(data?.contacts) ? data.contacts : null;
  const showRows = !state.loading && !state.error && contacts;
  const rangeLabel = !range
    ? 'Select a start and end date'
    : range.from
      ? range.from === range.to
        ? range.from
        : `${range.from} → ${range.to}`
      : 'All time';

  if (!session) return null;

  return (
    <div className="dash-wrapper">
      <nav className="dash-navbar">
        <div className="dash-navbar-brand">
          <img src="/logo.jpg" alt="Leslie's logo" className="dash-navbar-logo" />
          <div>
            <div className="dash-navbar-title">Customer Connect &amp; Support · Admin</div>
            <div className="dash-navbar-meta">
              {session.employeeName || session.employeeId} · Admin
            </div>
          </div>
        </div>
        <div className="dash-navbar-actions">
          <button className="btn ghost" onClick={logout}>
            <i className="fa-solid fa-arrow-right-from-bracket" />
            <span className="btn-label">Log out</span>
          </button>
        </div>
      </nav>

      <div className="dash-body">
        {/* ── Filters ── */}
        <div className="section-card admin-filters">
          <label className="admin-filter">
            <span>Store</span>
            <select value={storeFilter} onChange={(e) => selectStore(e.target.value)}>
              <option value="all">All Stores</option>
              {stores.map((s) => (
                <option key={s.store_nbr} value={s.store_nbr}>
                  Store {s.store_nbr}{s.store_name ? ` · ${s.store_name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-filter">
            <span>Date range</span>
            <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)}>
              {DATE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          {datePreset === 'custom' && (
            <>
              <label className="admin-filter">
                <span>From</span>
                <input
                  type="date"
                  value={customRange.from}
                  max={customRange.to || undefined}
                  onChange={(e) => setCustomRange((prev) => ({ ...prev, from: e.target.value }))}
                />
              </label>
              <label className="admin-filter">
                <span>To</span>
                <input
                  type="date"
                  value={customRange.to}
                  min={customRange.from || undefined}
                  onChange={(e) => setCustomRange((prev) => ({ ...prev, to: e.target.value }))}
                />
              </label>
            </>
          )}
          <div className="admin-filter-range">
            <i className="fa-regular fa-calendar" />
            {rangeLabel}
          </div>
        </div>

        {/* ── Store header (specific store only) ── */}
        {isStoreView && (
          <div className="section-card admin-section">
            <div className="store-header-back">
              <button type="button" className="btn outline" onClick={() => selectStore('all')}>
                <i className="fa-solid fa-arrow-left" />
                All Stores
              </button>
            </div>
            <StoreHeader loading={state.loading && isStale} store={isStale ? null : data?.store} />
          </div>
        )}

        {state.error && <div className="login-alert error admin-section">{state.error}</div>}

        {/* ── Metric cards (click to drill into the customer table) ── */}
        <div className="metric-grid admin-section">
          {METRIC_CARDS.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`metric-card ${card.tone}${activeStatus === card.status ? ' active' : ''}`}
              aria-pressed={activeStatus === card.status}
              onClick={() => toggleStatus(card.status)}
            >
              <div className="metric-card-icon">
                <i className={`fa-solid ${card.icon}`} />
              </div>
              <div>
                <div className="metric-card-label">Total {card.label}</div>
                <div className={`metric-card-value${state.loading ? ' refreshing' : ''}`}>
                  {metrics ? (
                    metrics[card.key].toLocaleString()
                  ) : state.loading ? (
                    <span className="skeleton-bar" style={{ width: 48, height: 26, display: 'block' }} />
                  ) : (
                    '—'
                  )}
                </div>
                <div className="metric-card-sub">
                  {activeStatus === card.status ? 'Showing below' : 'Click to view'}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* ── All stores: store directory with per-store counts ── */}
        {!isStoreView && !statusFilter && (
          <div className="section-card admin-section">
            <div className="section-header">
              <div>
                <p className="section-label">Locations</p>
                <h2 className="section-title">Stores</h2>
              </div>
              {!isStale && data?.stores && (
                <span className="muted">
                  {data.stores.length} store{data.stores.length === 1 ? '' : 's'} · click a store for details
                </span>
              )}
            </div>
            <div className="store-grid">
              {state.loading && isStale &&
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={`store-skel-${i}`} className="store-card skeleton">
                    <span className="skeleton-bar" style={{ width: '40%', height: 20, display: 'block' }} />
                    <span className="skeleton-bar" style={{ width: '75%', height: 14, display: 'block', marginTop: 12 }} />
                    <span className="skeleton-bar" style={{ width: '90%', height: 40, display: 'block', marginTop: 16 }} />
                  </div>
                ))}
              {!isStale &&
                (data?.stores || []).map((st) => <StoreCard key={st.store_nbr} store={st} onSelect={selectStore} />)}
              {!state.loading && !isStale && data?.stores?.length === 0 && (
                <p className="muted" style={{ padding: 8 }}>No active stores found in loc_rtl_loc.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Customer table: a store's customers, or a clicked metric's customers ── */}
        {showTable && (
          <div className="section-card admin-section admin-table-card" ref={tableRef}>
            <div className="section-header">
              <div>
                <p className="section-label">
                  {isStoreView ? `Store ${storeFilter}` : 'All Stores'} · Activity
                </p>
                <h2 className="section-title">{STATUS_LABELS[activeStatus] || 'Customers'}</h2>
              </div>
              <div className="admin-table-actions">
                {showRows && (
                  <span className="muted">
                    {contacts.length.toLocaleString()} customer{contacts.length === 1 ? '' : 's'}
                    {data.truncated && ' (showing first 500)'}
                  </span>
                )}
                {statusFilter && (
                  <button type="button" className="btn outline" onClick={() => setStatusFilter(null)}>
                    <i className="fa-solid fa-xmark" />
                    {isStoreView ? 'Clear filter' : 'Close'}
                  </button>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table className="contacts-table admin-table">
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Store</th>
                    <th>Status</th>
                    <th>Assigned To</th>
                    <th className="col-notes">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {state.loading &&
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`skeleton-${i}`} className="skeleton-row">
                        <td><span className="skeleton-bar" style={{ width: '70%' }} /></td>
                        <td><span className="skeleton-bar" style={{ width: '40%' }} /></td>
                        <td><span className="skeleton-bar" style={{ width: '60%' }} /></td>
                        <td><span className="skeleton-bar" style={{ width: '60%' }} /></td>
                        <td className="col-notes"><span className="skeleton-bar" style={{ width: '85%' }} /></td>
                      </tr>
                    ))}
                  {showRows &&
                    contacts.map((c) => (
                      <tr key={`${c.closed_store_number}-${c.customer_name}`}>
                        <td>{c.customer_name || '—'}</td>
                        <td>{c.closed_store_number || '—'}</td>
                        <td><StatusPills contact={c} /></td>
                        <td>
                          {c.assigned_employee_id ? (
                            <>
                              <div>{c.assigned_employee_name || c.assigned_employee_id}</div>
                              <div className="muted">{c.assigned_date}</div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="col-notes">
                          <span className={c.notes ? '' : 'muted'}>{c.notes || '—'}</span>
                        </td>
                      </tr>
                    ))}
                  {showRows && contacts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-cell">No matching customers in the selected range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
