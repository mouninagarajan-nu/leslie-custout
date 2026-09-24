// Admin and Employee session management (cleared on log out or tab close).
const KEY = 'custout.adminSession';
const EMP_KEY = 'custout.empSession';

export function saveAdminSession(session) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch (_) {
    // ignore
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

export function saveEmployeeSession(session) {
  try {
    window.sessionStorage.setItem(EMP_KEY, JSON.stringify(session));
  } catch (_) {
    // ignore
  }
}

export function loadEmployeeSession() {
  try {
    const raw = window.sessionStorage.getItem(EMP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function clearEmployeeSession() {
  try {
    window.sessionStorage.removeItem(EMP_KEY);
  } catch (_) {
    // ignore
  }
}
