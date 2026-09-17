'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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

  const fetchContacts = async () => {
    if (!storeNo || !employeeId) return;
    setContactsState({ loading: true, error: '' });
    try {
      const response = await fetch(
        `${API_BASE}/api/customer-contacts?openStore=${encodeURIComponent(storeNo)}&employeeId=${encodeURIComponent(employeeId)}`
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
    fetchContacts();
  }, [storeNo, employeeId]);

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
      // Refresh the page data automatically after submit
      await fetchContacts();
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

  return (
    <div className="page">
      <main className="card welcome-card">
        <header className="welcome-header">
          <div className="brand-badge">
            <img src="/logo.jpg" alt="Company logo" className="logo" />
          </div>
          <div className="welcome-headings">
            <h1>Welcome back, {employeeId || 'Employee'}!</h1>
            <p className="muted">Store: {storeNo || 'Not provided'}</p>
          </div>
          <div className="nav-actions">
            <button className="btn ghost" onClick={() => router.push('/')}>
              <i className="fa-solid fa-house"></i>
              Home
            </button>
            <button className="btn ghost" onClick={() => router.push('/')}>
              <i className="fa-solid fa-arrow-right-from-bracket"></i>
              Log out
            </button>
          </div>
        </header>

        <section className="data-section">
          <div className="data-header">
            <div>
              <p className="eyebrow">Activity</p>
              <h3>Customer Contacts</h3>
            </div>
            <button className="btn ghost" disabled={saveState.saving} onClick={handleSave}>
              {saveState.saving ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  Saving…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-paper-plane"></i>
                  Submit
                </>
              )}
            </button>
          </div>
          {saveState.message && (
            <div className="toast-notification">
              <i className="fa-solid fa-circle-check"></i>
              <span>{saveState.message}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setSaveState((prev) => ({ ...prev, message: '' }))}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          )}
          {!storeNo && (
            <div className="table-wrap">
              <p className="muted" style={{ padding: 16 }}>
                Please provide a store number from the login page.
              </p>
            </div>
          )}
          {storeNo && (
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
                      const isEditingNote = editingNoteIndex === originalIndex;
                      const isSavingNote = savingNoteIndex === originalIndex;
                      const rowNoteMessage = noteMessage?.index === originalIndex ? noteMessage : null;

                      return (
                        <tr key={originalIndex} className={rowClassName}>
                          <td>
                            {contact.customer_name || '—'}
                            {isCompleted && (
                              <span className="completed-badge">
                                <i className="fa-solid fa-check"></i>
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
                            {!canEdit && <span className="muted">{contact.notes || '—'}</span>}
                            {canEdit && !isEditingNote && (
                              <div className="note-view">
                                {contact.notes ? (
                                  <>
                                    <span className="note-text" title={contact.notes}>
                                      {contact.notes}
                                    </span>
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      title="Edit note"
                                      onClick={() => startEditNote(originalIndex, contact.notes)}
                                    >
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-btn danger"
                                      title="Delete note"
                                      disabled={isSavingNote}
                                      onClick={() => deleteNote(originalIndex)}
                                    >
                                      <i className="fa-solid fa-trash"></i>
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="add-note-btn"
                                    onClick={() => startEditNote(originalIndex, '')}
                                  >
                                    <i className="fa-solid fa-plus"></i>
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
                                  <i className={isSavingNote ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-check'}></i>
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  title="Cancel"
                                  disabled={isSavingNote}
                                  onClick={cancelEditNote}
                                >
                                  <i className="fa-solid fa-xmark"></i>
                                </button>
                              </div>
                            )}
                            {rowNoteMessage && (
                              <div className={`note-message ${rowNoteMessage.type}`}>{rowNoteMessage.text}</div>
                            )}
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
          )}
        </section>
      </main>
    </div>
  );
}
