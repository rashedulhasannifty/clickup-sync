import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MailCheck } from 'lucide-react';
import { authApi } from '../api/auth';
import { AuthShell, AuthCard, AuthHeading, AuthField, AuthSubmit, BrandMark } from '../components/auth/AuthShell';
import { isEmail } from '../lib/validation';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmail(email.trim())) { setError('Enter a valid email address'); return; }
    setLoading(true);
    setError('');
    try {
      await authApi.forgotPassword(email.trim());
    } catch {
      // The endpoint answers the same way for every address on purpose, so the
      // only failures left are transport ones — still show the neutral
      // confirmation rather than hinting at whether the account exists.
    }
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <AuthShell>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
        <AuthCard>
          <div style={{ textAlign: 'center', padding: '6px 4px 4px' }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, margin: '0 auto 14px', background: 'var(--muted-bg)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MailCheck size={22} />
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--text)' }}>Check your email</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
              If <strong style={{ color: 'var(--text)' }}>{email.trim()}</strong> has an account, we've sent a link to reset its password.
              The link expires in an hour.
            </p>
            <button onClick={() => navigate('/login')} style={{ marginTop: 16, background: 'none', border: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)', cursor: 'pointer' }}>Back to sign in</button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
      <AuthCard>
        <AuthHeading title="Reset your password" subtitle="We'll email you a link to choose a new one." />
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <AuthField
            label="Work email" type="email" name="email" icon={Mail} autoComplete="email" autoFocus
            value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }}
            placeholder="you@company.com"
            error={error || undefined}
          />
          <AuthSubmit loading={loading}>Send reset link</AuthSubmit>
        </form>
      </AuthCard>
      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 18 }}>
        Remembered it?{' '}
        <button onClick={() => navigate('/login')} style={{ background: 'none', border: 0, padding: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)', cursor: 'pointer' }}>Sign in</button>
      </p>
    </AuthShell>
  );
}
