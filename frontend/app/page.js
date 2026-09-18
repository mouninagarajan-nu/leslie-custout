'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function LoginPage() {
  const [form, setForm] = useState({ employeeId: '', storeNo: '' });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

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
      setStatus('');
      router.push(
        `/contacts?store=${encodeURIComponent(form.storeNo.trim())}&emp=${encodeURIComponent(form.employeeId.trim())}`
      );
    } catch (error) {
      setStatus('');
      setErrors({ auth: error.message || 'Unable to sign in. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const helperText = useMemo(() => {
    if (Object.keys(errors).length === 0) return '';
    return Object.values(errors)[0];
  }, [errors]);

  return (
    <div className="login-wrapper">
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
          <h1 className="form-title">Sign In</h1>
          <p className="form-subtitle">Employee authorization required.</p>

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
                autoComplete="off"
              />
            </div>

            <button type="submit" className="btn-signin" disabled={submitting}>
              {submitting ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {helperText && <div className="login-alert error">{helperText}</div>}
          {status && <div className="login-alert info">{status}</div>}

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
