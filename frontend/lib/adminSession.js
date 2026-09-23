// Admin session lives in sessionStorage (cleared when the tab closes).
// Storage access can throw (private mode, blocked site data), so every call is guarded.
const KEY = 'custout.adminSession';

export function saveAdminSession(session) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch (_) {
    // ignore — the admin will simply need to sign in again
  }
}

export function loadAdminSession() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function clearAdminSession() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch (_) {
    // ignore
  }
}
