import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh, user } = useAuth();

  useEffect(() => {
    if (user) navigate('/overview', { replace: true });
  }, [user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.login(email.trim(), password);
      await refresh();
      navigate('/overview', { replace: true });
    } catch {
      setError('Invalid email or password');
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
          <h1 className="text-xl font-bold text-[var(--text)]">ClickUp Sync</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Internal dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter your password"
              autoComplete="current-password"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            {error && <p className="text-xs text-[var(--red)] mt-1">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-sm font-medium text-white rounded-[var(--radius)] transition-colors disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-[var(--text-muted)] text-center mt-6">
          <Link to="/signup" className="hover:text-[var(--accent)] transition-colors">
            Set up your organization →
          </Link>
        </p>
      </div>
    </div>
  );
}
