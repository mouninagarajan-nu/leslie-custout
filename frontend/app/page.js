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
    <div className="page">
      <main className="card auth-card">
        <div className="brand-badge">
          <img src="/logo.jpg" alt="Company logo" className="logo" />
        </div>
        <div className="card-header">
          <div className="icon-badge">
            <i className="fa-solid fa-user-check"></i>
          </div>
          <div className="title">Employee Login</div>
          <p className="muted">Enter your Employee ID and Store No. to continue.</p>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label className="input">
            <span><i className="fa-solid fa-id-badge"></i>Employee ID</span>
            <input
              type="text"
              value={form.employeeId}
              onChange={(e) => handleChange('employeeId', e.target.value)}
              placeholder=""
              autoComplete="off"
            />
          </label>
          <label className="input">
            <span><i className="fa-solid fa-store"></i>Store No.</span>
            <input
              type="text"
              value={form.storeNo}
              onChange={(e) => handleChange('storeNo', e.target.value)}
              placeholder=""
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn block primary" disabled={submitting}>
            {submitting ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                Signing in…
              </>
            ) : (
              <>
                <i className="fa-solid fa-arrow-right-to-bracket"></i>
                Login
              </>
            )}
          </button>
        </form>

        <div className="card-footer">
          {helperText && <div className="error">{helperText}</div>}
          {status && <div className="status">{status}</div>}
        </div>
      </main>
    </div>
  );
}
