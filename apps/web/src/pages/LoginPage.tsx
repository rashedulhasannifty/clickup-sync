import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function LoginPage() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem('adminApiKey')) navigate('/overview', { replace: true });
  }, [navigate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) { setError('Please enter your admin API key'); return; }
    localStorage.setItem('adminApiKey', key.trim());
    navigate('/overview', { replace: true });
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
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-1.5">Admin API Key</label>
            <input
              type="password"
              value={key}
              onChange={e => { setKey(e.target.value); setError(''); }}
              placeholder="Enter your admin key"
              autoComplete="current-password"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            {error && <p className="text-xs text-[var(--red)] mt-1">{error}</p>}
          </div>

          <button
            type="submit"
            className="w-full py-2 text-sm font-medium text-white rounded-[var(--radius)] transition-colors"
            style={{ background: 'var(--accent)' }}
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
