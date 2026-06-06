import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { User, Lock, MailCheck } from 'lucide-react';
import { authApi } from '../api/auth';
import type { Role } from '../api/auth';
import { AuthShell, AuthField, PasswordField, AuthButton, AuthError } from '../components/auth/AuthShell';

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
      .then((res) => {
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

  if (previewError) {
    return (
      <AuthShell
        title="Invitation unavailable"
        subtitle={previewError}
        footer={
          <Link to="/login" className="text-xs font-medium text-[var(--accent)] hover:underline">
            Go to sign in
          </Link>
        }
      >
        <div />
      </AuthShell>
    );
  }

  if (!info) {
    return (
      <AuthShell title="Accept invitation" subtitle="Loading invitation…">
        <div className="h-11 rounded-[var(--radius)] bg-[var(--skeleton)] animate-pulse" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${info.orgName}`}
      icon={MailCheck}
      subtitle={
        <>
          You're invited as <span className="font-semibold text-[var(--text)]">{info.role}</span>
          <br />
          {info.email}
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AuthField
          label="Your name"
          icon={User}
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder="e.g. Rashedul"
          autoComplete="name"
          autoFocus
        />
        <PasswordField
          label="Password"
          icon={Lock}
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Create a password"
          autoComplete="new-password"
          hint="At least 10 characters"
        />
        <AuthError message={error} />
        <AuthButton type="submit" loading={loading}>
          {loading ? 'Accepting…' : 'Accept & set password'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
