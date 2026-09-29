'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveAdminSession,
  loadAdminSession,
  saveEmployeeSession,
  loadEmployeeSession
} from '../lib/adminSession';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const ADMIN_STORE_NUMBER = process.env.NEXT_PUBLIC_ADMIN_STORE_NUMBER || '9999';

export default function LoginPage() {
  const [form, setForm] = useState({ employeeId: '', storeNo: '' });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const router = useRouter();

  // If already logged in, automatically redirect to active session (prevents seeing login page while logged in)
  useEffect(() => {
    const adminSession = loadAdminSession();
    if (adminSession?.token) {
      router.replace('/admin');
      return;
    }
    const empSession = loadEmployeeSession();
    if (empSession?.storeNo && empSession?.employeeId) {
      router.replace(
        `/contacts?store=${encodeURIComponent(empSession.storeNo)}&emp=${encodeURIComponent(empSession.employeeId)}`
      );
      return;
    }
    setIsCheckingSession(false);
  }, [router]);

  const helperText = useMemo(() => {
    if (Object.keys(errors).length === 0) return '';
    return Object.values(errors)[0];
  }, [errors]);

  const switchMode = (admin) => {
    setIsAdminMode(admin);
    setForm((prev) => ({ ...prev, storeNo: admin ? ADMIN_STORE_NUMBER : '' }));
    resetStatus();
  };

  const resetStatus = () => {
    setStatus('');
    setErrors({});
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    resetStatus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.employeeId.trim()) nextErrors.employeeId = 'Employee ID is required.';
    if (!form.storeNo.trim()) nextErrors.storeNo = 'Store number is required.';
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setStatus('Signing in…');
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: form.employeeId.trim(),
          storeNumber: form.storeNo.trim()
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || 'Invalid Employee ID or Store Number.');
      }
      if (body?.isAdmin && body?.adminToken) {
        saveAdminSession({
          token: body.adminToken,
          employeeId: body.employeeId,
          employeeName: body.employeeName
        });
        setStatus('');
        router.replace('/admin');
        return;
      }
      if (isAdminMode) {
        throw new Error('This account does not have admin access.');
      }
      saveEmployeeSession({
        storeNo: form.storeNo.trim(),
        employeeId: form.employeeId.trim(),
        employeeName: body.employeeName
      });
      setStatus('');
      router.replace(
        `/contacts?store=${encodeURIComponent(form.storeNo.trim())}&emp=${encodeURIComponent(form.employeeId.trim())}`
      );
    } catch (error) {
      setStatus('');
      setErrors({ auth: error.message || 'Unable to sign in. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="login-wrapper" style={{ background: 'var(--navy-900)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100%', color: '#fff' }}>
          <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: 24, color: '#38bdf8' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrapper">
      {/* ── Top-center status toast ── */}
      {status && (
        <div className="toast-top">
          <i className="fa-solid fa-circle-notch fa-spin" />
          {status}
        </div>
      )}

      {/* ── Left: Hero panel ── */}
      <div className="hero-panel">
        <div className="hero-brand-badge">
          <i className="fa-solid fa-headset" />
          Customer Connect &amp; Support
        </div>
        <div className="hero-branding">
          <img src="/logo.jpg" alt="Leslie's" className="hero-logo" />
          <p className="hero-tagline">We know pools.</p>
          <svg className="hero-wave" viewBox="0 0 220 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 14 C40 2, 80 2, 110 10 C140 18, 180 18, 218 6" stroke="#0284c7" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          </svg>
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="form-panel">
        <div className="form-panel-inner">
          <img src="/logo.jpg" alt="Leslie's logo" className="form-logo" />
          <h1 className="form-title">{isAdminMode ? 'Admin Sign In' : 'Sign In'}</h1>
          <p className="form-subtitle">
            {isAdminMode ? 'Administrator authorization required.' : 'Employee authorization required.'}
          </p>

          <div className="login-mode-toggle" role="tablist" aria-label="Sign-in type">
            <button
              type="button"
              role="tab"
              aria-selected={!isAdminMode}
              className={!isAdminMode ? 'active' : ''}
              onClick={() => switchMode(false)}
            >
              <i className="fa-solid fa-user" />
              Employee
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isAdminMode}
              className={isAdminMode ? 'active' : ''}
              onClick={() => switchMode(true)}
            >
              <i className="fa-solid fa-user-shield" />
              Admin
            </button>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            {/* Employee ID */}
            <div className="field-wrapper">
              <i className="fa-solid fa-id-badge field-icon" />
              <input
                type="text"
                className="field-input"
                placeholder="Employee ID"
                value={form.employeeId}
                onChange={(e) => handleChange('employeeId', e.target.value)}
                autoComplete="off"
              />
            </div>

            {/* Store No. */}
            <div className="field-wrapper">
              <i className="fa-solid fa-store field-icon" />
              <input
                type="text"
                className="field-input"
                placeholder="Store No."
                value={form.storeNo}
                onChange={(e) => handleChange('storeNo', e.target.value)}
                readOnly={isAdminMode}
                title={isAdminMode ? 'Admins sign in with the virtual admin store' : undefined}
                autoComplete="off"
              />
            </div>

            <button type="submit" className="btn-signin" disabled={submitting}>
              {submitting ? (
                <i className="fa-solid fa-circle-notch fa-spin" />
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {helperText && <div className="login-alert error">{helperText}</div>}

          <div className="login-footer-icons">
            <i className="fa-solid fa-tree" style={{ color: '#0077c8' }} />
            <i className="fa-solid fa-water" style={{ color: '#38bdf8' }} />
            <i className="fa-solid fa-tree" style={{ color: '#0077c8' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
