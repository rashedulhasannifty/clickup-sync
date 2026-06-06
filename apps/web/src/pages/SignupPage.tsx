import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';

export function SignupPage() {
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  function update(field: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.signup({
        orgName: form.orgName,
        name: form.name,
        email: form.email.trim(),
        password: form.password,
      });
      await refresh();
      navigate('/overview', { replace: true });
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('Signup is closed — ask an admin for an invite.');
      } else {
        setError('Could not create your account.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--page-bg)' }}>
      <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-8 shadow-lg">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl mb-4" style={{ background: 'var(--accent-grad)' }} />
          <h1 className="text-xl font-bold text-[var(--text)]">Set up your organization</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Create the owner account</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Organization name</label>
            <input
              type="text"
              value={form.orgName}
              onChange={e => update('orgName', e.target.value)}
              placeholder="Acme Inc."
              autoComplete="organization"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Your name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => update('name', e.target.value)}
              placeholder="e.g. rashedul"
              autoComplete="name"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => update('password', e.target.value)}
              placeholder="Create a password"
              autoComplete="new-password"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            <p className="text-xs text-[var(--text-faint)] mt-1">At least 10 characters</p>
            {error && <p className="text-xs text-[var(--red)] mt-1">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-sm font-medium text-white rounded-[var(--radius)] transition-colors disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? 'Creating…' : 'Create organization'}
          </button>
        </form>

        <p className="text-xs text-[var(--text-muted)] text-center mt-6">
          <Link to="/login" className="hover:text-[var(--accent)] transition-colors">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
