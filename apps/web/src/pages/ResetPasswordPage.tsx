import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { AuthShell, AuthCard, AuthHeading, AuthField, AuthSubmit, BrandMark, PasswordStrength } from '../components/auth/AuthShell';

const INVALID = 'This password reset link is invalid or has expired.';

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) { setPreviewError(INVALID); return; }
    authApi.previewReset(token)
      .then((res) => { if (active) setEmail(res.email); })
      .catch(() => { if (active) setPreviewError(INVALID); });
    return () => { active = false; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    // Match the backend policy (@MinLength(10)) before the API round-trip.
    if (password.length < 10) { setError('Password must be at least 10 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      // The reset issues a fresh session, so we land signed in.
      await refresh();
      navigate('/overview', { replace: true });
    } catch {
      setError('Could not reset your password. The link may have expired.');
      setLoading(false);
    }
  }

  if (previewError) {
    return (
      <AuthShell>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
        <AuthCard>
          <div style={{ textAlign: 'center', padding: '6px 4px 4px' }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--text)' }}>Link unavailable</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>{previewError}</p>
            <button onClick={() => navigate('/forgot')} style={{ marginTop: 16, background: 'none', border: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)', cursor: 'pointer' }}>Request a new link</button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  if (!email) {
    return (
      <AuthShell>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
        <AuthCard>
          <div style={{ height: 120, borderRadius: 10, background: 'var(--skeleton)', animation: 'shimmer 1.4s linear infinite' }} />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
      <AuthCard>
        <AuthHeading title="Choose a new password" subtitle={`for ${email}`} />
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <AuthField
            label="New password" type="password" name="password" icon={Lock} autoComplete="new-password" autoFocus
            value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="At least 10 characters"
          />
          <PasswordStrength value={password} />
          <AuthField
            label="Confirm password" type="password" name="confirm" icon={Lock} autoComplete="new-password"
            value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(''); }}
            placeholder="Repeat your new password"
            error={error || undefined}
          />
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
            Setting a new password signs you out everywhere else.
          </p>
          <AuthSubmit loading={loading}>Set new password</AuthSubmit>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
