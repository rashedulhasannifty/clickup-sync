import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { authApi } from '../api/auth';
import type { Role } from '../api/auth';

interface InviteInfo {
  email: string;
  role: Role;
  orgName: string;
}

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) {
      setPreviewError('This invitation is invalid or has expired.');
      return;
    }
    authApi
      .previewInvite(token)
      .then(res => {
        if (active) setInfo({ email: res.email, role: res.role, orgName: res.orgName });
      })
      .catch(() => {
        if (active) setPreviewError('This invitation is invalid or has expired.');
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!name.trim() || !password) {
      setError('Enter your name and a password');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.acceptInvite(token, name.trim(), password);
      navigate('/login', { replace: true, state: { invited: true } });
    } catch {
      setError('Could not accept the invitation.');
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
          {info ? (
            <>
              <h1 className="text-xl font-bold text-[var(--text)]">Join {info.orgName}</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                You're invited as {info.role} ({info.email})
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[var(--text)]">Accept invitation</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">ClickUp Sync</p>
            </>
          )}
        </div>

        {info ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Your name</label>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError(''); }}
                placeholder="e.g. rashedul"
                autoComplete="name"
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
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
              {loading ? 'Accepting…' : 'Accept & set password'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--red)] text-center">
              {previewError || 'Loading invitation…'}
            </p>
            {previewError && (
              <p className="text-xs text-[var(--text-muted)] text-center">
                <Link to="/login" className="hover:text-[var(--accent)] transition-colors">
                  Go to sign in
                </Link>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
