'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import StoreHeader from '../components/StoreHeader';
import { clearEmployeeSession } from '../../lib/adminSession';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const toBool = (value) => {
  const str = String(value ?? '').trim().toLowerCase();
  return value === true || str === 'y' || str === 'yes' || str === 'true' || str === '1';
};

export default function ContactsClient() {
  const searchParams = useSearchParams();
  const storeNo = searchParams.get('store') || '';
  const employeeId = searchParams.get('emp') || '';
  const router = useRouter();

  const [contacts, setContacts] = useState([]);
  const [contactsState, setContactsState] = useState({ loading: false, error: '' });
  const [saveState, setSaveState] = useState({ saving: false, message: '' });
  const [storeInfo, setStoreInfo] = useState(null);

  // Notes CRUD state: only one row's note can be in edit mode at a time.
  const [editingNoteIndex, setEditingNoteIndex] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNoteIndex, setSavingNoteIndex] = useState(null);
  const [noteMessage, setNoteMessage] = useState(null); // { index, text, type }

  const toggleFlag = (index, field) => {
    setContacts((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: !toBool(item[field]) } : item
      )
    );
  };

  const fetchContacts = async (assignNew = false) => {
    if (!storeNo || !employeeId) return;
    setContactsState({ loading: true, error: '' });
    try {
      const response = await fetch(
        `${API_BASE}/api/customer-contacts?openStore=${encodeURIComponent(storeNo)}&employeeId=${encodeURIComponent(employeeId)}&assign=${assignNew}&_t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        let details = '';
        try {
          const body = await response.json();
          details = body?.error ? `: ${body.error}` : '';
        } catch (_) {
          // ignore
        }
        throw new Error(`Request failed (${response.status})${details}`);
      }
      const data = await response.json();
      setContacts(Array.isArray(data) ? data : []);
      setContactsState({ loading: false, error: '' });
    } catch (error) {
      setContactsState({
        loading: false,
        error:
          error?.message ||
          'Unable to load customer contacts. Please try again.'
      });
    }
  };

  useEffect(() => {
    // Trap browser back button while logged in to prevent navigating back to login page
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
    // Only assign new tasks on initial component mount (when arriving from login or a fresh refresh)
    fetchContacts(true);
  }, [storeNo, employeeId]);

  // Store name/address header; stays hidden if the store has no loc_rtl_loc row.
  useEffect(() => {
    if (!storeNo) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/stores?store=${encodeURIComponent(storeNo)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((row) => !cancelled && setStoreInfo(row))
      .catch(() => !cancelled && setStoreInfo(null));
    return () => {
      cancelled = true;
    };
  }, [storeNo]);

  // Auto-dismiss save notification toast after 3 seconds
  useEffect(() => {
    if (!saveState.message) return;
    const timer = setTimeout(() => {
      setSaveState((prev) => ({ ...prev, message: '' }));
    }, 3000);
    return () => clearTimeout(timer);
  }, [saveState.message]);

  const handleSave = async () => {
    if (!storeNo) return;
    setSaveState({ saving: true, message: '' });
    try {
      const payload = contacts
        .filter((c) => c.is_actionable)
        .map((c) => {
          const contacted = toBool(c.contacted_to_store) ? 'Y' : 'N';
          const attempted =
            contacted === 'Y'
              ? 'Y'
              : toBool(c.attempted_to_store)
                ? 'Y'
                : 'N';
          const doNotAttempt = toBool(c.do_not_attempt) ? 'Y' : 'N';
          const notes = (c.notes || '').trim();
          return {
            customer_name: c.customer_name,
            contacted_to_store: contacted,
            attempted_to_store: attempted,
            do_not_attempt: doNotAttempt,
            notes
          };
        })
        // Only include rows where at least one box is checked
        .filter(
          (c) =>
            c.contacted_to_store === 'Y' ||
            c.attempted_to_store === 'Y' ||
            c.do_not_attempt === 'Y'
        );

      if (payload.length === 0) {
        setSaveState({ saving: false, message: 'No contacts selected to update.' });
        return;
      }

      const response = await fetch(`${API_BASE}/api/customer-contacts/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeNumber: storeNo, contacts: payload })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${response.status})`);
      }
      const body = await response.json().catch(() => ({}));
      setSaveState({ saving: false, message: body?.message || 'Saved' });
      // Refresh the page data automatically after submit (without assigning new ones)
      await fetchContacts(false);
    } catch (error) {
      setSaveState({ saving: false, message: error.message || 'Save failed' });
    }
  };

  // Notes are their own CRUD surface: each save/delete round-trips immediately,
  // independent of the checkbox Submit button above.
  const persistNote = async (index, nextNotes) => {
    const contact = contacts[index];
    if (!contact) return;
    setSavingNoteIndex(index);
    setNoteMessage(null);
    try {
      const contacted = toBool(contact.contacted_to_store) ? 'Y' : 'N';
      const attempted =
        contacted === 'Y' ? 'Y' : toBool(contact.attempted_to_store) ? 'Y' : 'N';
      const doNotAttempt = toBool(contact.do_not_attempt) ? 'Y' : 'N';

      const response = await fetch(`${API_BASE}/api/customer-contacts/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeNumber: storeNo,
          contacts: [
            {
              customer_name: contact.customer_name,
              contacted_to_store: contacted,
              attempted_to_store: attempted,
              do_not_attempt: doNotAttempt,
              notes: nextNotes
            }
          ]
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${response.status})`);
      }

      setContacts((prev) =>
        prev.map((item, i) => (i === index ? { ...item, notes: nextNotes } : item))
      );
      setEditingNoteIndex(null);
      setNoteMessage({ index, text: nextNotes ? 'Note saved.' : 'Note deleted.', type: 'success' });
    } catch (error) {
      setNoteMessage({ index, text: error.message || 'Failed to save note.', type: 'error' });
    } finally {
      setSavingNoteIndex(null);
    }
  };

  const startEditNote = (index, currentValue) => {
    setNoteMessage(null);
    setEditingNoteIndex(index);
    setNoteDraft(currentValue || '');
  };

  const cancelEditNote = () => {
    setEditingNoteIndex(null);
    setNoteDraft('');
  };

  const saveEditNote = (index) => {
    persistNote(index, noteDraft.trim());
  };

  const deleteNote = (index) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this note?')) return;
    persistNote(index, '');
  };

  // ── Shared note cell renderer (used in both table and cards) ──
  const renderNoteCell = (contact, originalIndex) => {
    const canEdit = !!contact.is_actionable;
    const isEditingNote = editingNoteIndex === originalIndex;
    const isSavingNote = savingNoteIndex === originalIndex;
    const rowNoteMessage = noteMessage?.index === originalIndex ? noteMessage : null;

    return (
      <>
        {!canEdit && <span className="muted">{contact.notes || '—'}</span>}
        {canEdit && !isEditingNote && (
          <div className="note-view">
            {contact.notes ? (
              <>
                <span className="note-text" title={contact.notes}>{contact.notes}</span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Edit note"
                  onClick={() => startEditNote(originalIndex, contact.notes)}
                >
                  <i className="fa-solid fa-pen" />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Delete note"
                  disabled={isSavingNote}
                  onClick={() => deleteNote(originalIndex)}
                >
                  <i className="fa-solid fa-trash" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="add-note-btn"
                onClick={() => startEditNote(originalIndex, '')}
              >
                <i className="fa-solid fa-plus" />
                Add note
              </button>
            )}
          </div>
        )}
        {canEdit && isEditingNote && (
          <div className="note-edit">
            <input
              type="text"
              autoFocus
              value={noteDraft}
              placeholder="Add a note…"
              onChange={(e) => setNoteDraft(e.target.value)}
              disabled={isSavingNote}
            />
            <button
              type="button"
              className="icon-btn success"
              title="Save note"
              disabled={isSavingNote}
              onClick={() => saveEditNote(originalIndex)}
            >
              <i className={isSavingNote ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-check'} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Cancel"
              disabled={isSavingNote}
              onClick={cancelEditNote}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        )}
        {rowNoteMessage && (
          <div className={`note-message ${rowNoteMessage.type}`}>{rowNoteMessage.text}</div>
        )}
      </>
    );
  };

  return (
    <div className="dash-wrapper">
      {/* ── Top navigation bar ── */}
      <nav className="dash-navbar">
        <div className="dash-navbar-brand">
          <img src="/logo.jpg" alt="Leslie's logo" className="dash-navbar-logo" />
          <div>
            <div className="dash-navbar-title">Customer Connect &amp; Support</div>
            <div className="dash-navbar-meta">
              {employeeId && <>Employee {employeeId}{storeNo && <> · Store {storeNo}</>}</>}
            </div>
          </div>
        </div>
        <div className="dash-navbar-actions">
          <button className="btn ghost" onClick={() => fetchContacts(true)}>
            <i className="fa-solid fa-rotate-right" />
            <span className="btn-label">Refresh</span>
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              clearEmployeeSession();
              router.replace('/');
            }}
          >
            <i className="fa-solid fa-arrow-right-from-bracket" />
            <span className="btn-label">Log out</span>
          </button>
        </div>
      </nav>

      {/* ── Main body ── */}
      <div className="dash-body">
        {storeInfo && (
          <div className="section-card admin-section">
            <StoreHeader store={storeInfo} />
          </div>
        )}
        <div className="section-card">
          {/* Section header */}
          <div className="section-header">
            <div>
              <p className="section-label">Activity</p>
              <h2 className="section-title">Customer Contacts</h2>
            </div>
            {/* Desktop submit button — hidden on mobile via CSS */}
            <button className="btn primary" disabled={saveState.saving} onClick={handleSave}>
              {saveState.saving ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-paper-plane" />
                  Submit
                </>
              )}
            </button>
          </div>

          {/* Toast */}
          {saveState.message && (
            <div className="toast-notification">
              <i className="fa-solid fa-circle-check" />
              <span>{saveState.message}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setSaveState((prev) => ({ ...prev, message: '' }))}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          {/* No store */}
          {!storeNo && (
            <div className="table-wrap">
              <p className="muted" style={{ padding: 20 }}>
                Please provide a store number from the login page.
              </p>
            </div>
          )}

          {storeNo && (
            <>
              {/* ═══════════════════════════════════════
                  DESKTOP: Table view (hidden on mobile)
                  ═══════════════════════════════════════ */}
              <div className="table-wrap">
                <table className="contacts-table">
                  <thead>
                    <tr>
                      <th>Customer Name</th>
                      <th>Phone Number</th>
                      <th>Closed Store</th>
                      <th className="col-checkbox">Do Not Attempt</th>
                      <th className="col-checkbox">Contacted</th>
                      <th className="col-checkbox">Attempted</th>
                      <th className="col-notes">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contactsState.loading &&
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={`skeleton-${i}`} className="skeleton-row">
                          <td><span className="skeleton-bar" style={{ width: '75%' }} /></td>
                          <td><span className="skeleton-bar" style={{ width: '60%' }} /></td>
                          <td><span className="skeleton-bar" style={{ width: '35%' }} /></td>
                          <td className="col-checkbox"><span className="skeleton-checkbox" /></td>
                          <td className="col-checkbox"><span className="skeleton-checkbox" /></td>
                          <td className="col-checkbox"><span className="skeleton-checkbox" /></td>
                          <td className="col-notes"><span className="skeleton-bar" style={{ width: '85%' }} /></td>
                        </tr>
                      ))}
                    {!contactsState.loading && contactsState.error && (
                      <tr>
                        <td colSpan={7} className="empty-cell error-cell">{contactsState.error}</td>
                      </tr>
                    )}
                    {!contactsState.loading &&
                      !contactsState.error &&
                      contacts.map((contact, originalIndex) => {
                        const isContacted = toBool(contact.contacted_to_store);
                        const isAttempted = toBool(contact.attempted_to_store);
                        const isDoNotAttempt = toBool(contact.do_not_attempt);
                        const attemptedChecked = isAttempted || isContacted;
                        const canEdit = !!contact.is_actionable;
                        const isCompleted = !!contact.is_completed;
                        const rowClassName = isCompleted ? 'row-completed' : !canEdit ? 'row-disabled' : '';
                        const closedStore =
                          contact.closed_store_number ??
                          contact.store_number ??
                          contact.closed_store ??
                          '—';

                        return (
                          <tr key={originalIndex} className={rowClassName}>
                            <td>
                              {contact.customer_name || '—'}
                              {isCompleted && (
                                <span className="completed-badge">
                                  <i className="fa-solid fa-check" />
                                  Completed
                                </span>
                              )}
                            </td>
                            <td>{contact.phone_number || '—'}</td>
                            <td>{closedStore}</td>
                            <td className="col-checkbox">
                              <input
                                type="checkbox"
                                checked={isDoNotAttempt}
                                onChange={canEdit ? () => toggleFlag(originalIndex, 'do_not_attempt') : undefined}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="col-checkbox">
                              <input
                                type="checkbox"
                                checked={isContacted}
                                onChange={canEdit ? () => toggleFlag(originalIndex, 'contacted_to_store') : undefined}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="col-checkbox">
                              <input
                                type="checkbox"
                                checked={attemptedChecked}
                                onChange={canEdit ? () => toggleFlag(originalIndex, 'attempted_to_store') : undefined}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="col-notes">
                              {renderNoteCell(contact, originalIndex)}
                            </td>
                          </tr>
                        );
                      })}
                    {!contactsState.loading &&
                      !contactsState.error &&
                      contacts.length === 0 && (
                        <tr>
                          <td colSpan={7} className="empty-cell">No customers found for this store.</td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>

              {/* ═══════════════════════════════════════
                  MOBILE: Card view (hidden on desktop)
                  ═══════════════════════════════════════ */}
              <div className="contact-cards">
                {contactsState.loading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={`card-skeleton-${i}`} className="contact-card">
                      <div className="contact-card-header">
                        <div className="contact-card-avatar" style={{ background: 'var(--gray-200)' }} />
                        <div className="contact-card-header-info">
                          <span className="skeleton-bar" style={{ width: '65%', height: 15, display: 'block' }} />
                        </div>
                      </div>
                      <div className="contact-card-meta">
                        <span className="skeleton-bar" style={{ width: 100, height: 26, borderRadius: 999 }} />
                        <span className="skeleton-bar" style={{ width: 60, height: 26, borderRadius: 999 }} />
                      </div>
                    </div>
                  ))}

                {!contactsState.loading && contactsState.error && (
                  <div className="contact-card">
                    <div className="contact-card-header">
                      <p className="muted" style={{ color: 'var(--danger)', margin: 0 }}>{contactsState.error}</p>
                    </div>
                  </div>
                )}

                {!contactsState.loading && !contactsState.error && contacts.length === 0 && (
                  <div className="contact-card">
                    <div className="contact-card-header">
                      <p className="muted" style={{ margin: 0 }}>No customers found for this store.</p>
                    </div>
                  </div>
                )}

                {!contactsState.loading &&
                  !contactsState.error &&
                  contacts.map((contact, originalIndex) => {
                    const isContacted = toBool(contact.contacted_to_store);
                    const isAttempted = toBool(contact.attempted_to_store);
                    const isDoNotAttempt = toBool(contact.do_not_attempt);
                    const attemptedChecked = isAttempted || isContacted;
                    const canEdit = !!contact.is_actionable;
                    const isCompleted = !!contact.is_completed;
                    const closedStore =
                      contact.closed_store_number ??
                      contact.store_number ??
                      contact.closed_store ??
                      '—';

                    // Generate initials from customer name
                    const nameParts = (contact.customer_name || '').trim().split(' ');
                    const initials = nameParts.length >= 2
                      ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`
                      : (nameParts[0]?.[0] || '?');

                    const avatarBg = isCompleted ? 'var(--success)' : !canEdit ? 'var(--gray-400)' : 'var(--navy-700)';

                    const cardClass = [
                      'contact-card',
                      isCompleted ? 'card-completed' : '',
                      !canEdit ? 'card-disabled' : '',
                    ].filter(Boolean).join(' ');

                    return (
                      <div key={`card-${originalIndex}`} className={cardClass}>
                        {/* Header: avatar + name */}
                        <div className="contact-card-header">
                          <div className="contact-card-avatar" style={{ background: avatarBg }}>
                            {initials.toUpperCase()}
                          </div>
                          <div className="contact-card-header-info">
                            <div className="contact-card-name">{contact.customer_name || '—'}</div>
                            {isCompleted && (
                              <span className="completed-badge" style={{ marginLeft: 0, marginTop: 4, display: 'inline-flex' }}>
                                <i className="fa-solid fa-check" />
                                Completed
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Pill meta: phone & store */}
                        <div className="contact-card-meta">
                          <span className="contact-card-pill">
                            <i className="fa-solid fa-phone" />
                            {contact.phone_number || '—'}
                          </span>
                          <span className="contact-card-pill">
                            <i className="fa-solid fa-store" />
                            Store {closedStore}
                          </span>
                        </div>

                        {/* Checkboxes */}
                        <div className="contact-card-checks">
                          <label className="contact-card-check-row">
                            <input
                              type="checkbox"
                              checked={isDoNotAttempt}
                              onChange={canEdit ? () => toggleFlag(originalIndex, 'do_not_attempt') : undefined}
                              disabled={!canEdit}
                            />
                            Do Not Attempt
                          </label>
                          <label className="contact-card-check-row">
                            <input
                              type="checkbox"
                              checked={isContacted}
                              onChange={canEdit ? () => toggleFlag(originalIndex, 'contacted_to_store') : undefined}
                              disabled={!canEdit}
                            />
                            Contacted
                          </label>
                          <label className="contact-card-check-row">
                            <input
                              type="checkbox"
                              checked={attemptedChecked}
                              onChange={canEdit ? () => toggleFlag(originalIndex, 'attempted_to_store') : undefined}
                              disabled={!canEdit}
                            />
                            Attempted
                          </label>
                        </div>

                        {/* Notes */}
                        <div className="contact-card-notes">
                          <div className="contact-card-notes-label">Notes</div>
                          {renderNoteCell(contact, originalIndex)}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Sticky mobile submit bar (shown only on ≤640px via CSS) ── */}
      {storeNo && (
        <div className="mobile-submit-bar">
          <button className="btn primary" disabled={saveState.saving} onClick={handleSave}>
            {saveState.saving ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin" />
                Saving…
              </>
            ) : (
              <>
                <i className="fa-solid fa-paper-plane" />
                Submit
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
