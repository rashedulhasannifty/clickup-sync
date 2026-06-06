import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mail, User, Lock, Plus, Shield, Ban } from 'lucide-react';
import { authApi } from '../api/auth';
import type { Role } from '../api/auth';
import {
  AuthShell, AuthCard, AuthField, AuthSubmit, BrandMark,
} from '../components/auth/AuthShell';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';

interface InviteInfo { email: string; role: Role; orgName: string }

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' };

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) { setPreviewError('This invitation is invalid or has expired.'); return; }
    authApi.previewInvite(token)
      .then((res) => { if (active) setInfo({ email: res.email, role: res.role, orgName: res.orgName }); })
      .catch(() => { if (active) setPreviewError('This invitation is invalid or has expired.'); });
    return () => { active = false; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!name.trim() || !password) { setError('Enter your name and a password'); return; }
    setLoading(true);
    setError('');
    try {
      await authApi.acceptInvite(token, name.trim(), password);
      navigate('/login', { replace: true, state: { invited: true } });
    } catch {
      setError('Could not accept the invitation.');
      setLoading(false);
    }
  }

  // Declined
  if (declined) {
    return (
      <AuthShell>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
        <AuthCard>
          <div style={{ textAlign: 'center', padding: '6px 4px 4px' }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, margin: '0 auto 14px', background: 'var(--muted-bg)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ban size={22} />
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--text)' }}>Invitation declined</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
              No problem — you can close this window. If this was a mistake, ask for a new invitation.
            </p>
            <button onClick={() => navigate('/login')} style={{ marginTop: 16, background: 'none', border: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)', cursor: 'pointer' }}>Back to sign in</button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  // Invalid / expired
  if (previewError) {
    return (
      <AuthShell>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
        <AuthCard>
          <div style={{ textAlign: 'center', padding: '6px 4px 4px' }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--text)' }}>Invitation unavailable</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>{previewError}</p>
            <button onClick={() => navigate('/login')} style={{ marginTop: 16, background: 'none', border: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)', cursor: 'pointer' }}>Go to sign in</button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  // Loading
  if (!info) {
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
    <AuthShell maxWidth={440}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
      <AuthCard>
        {/* Invitation header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingBottom: 18, borderBottom: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ borderRadius: 999, boxShadow: '0 0 0 3px var(--surface)' }}><BrandMark size={44} showText={false} /></span>
            <span style={{ width: 30, height: 30, margin: '0 -4px', borderRadius: 999, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', position: 'relative', zIndex: 1, boxShadow: '0 0 0 3px var(--surface)' }}>
              <Plus size={14} />
            </span>
            <span style={{ borderRadius: 999, boxShadow: '0 0 0 3px var(--surface)' }}><Avatar name={info.email} size={44} /></span>
          </div>
          <h1 style={{ fontSize: 19, fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.01em' }}>You've been invited</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.55, maxWidth: 340 }}>
            You've been invited to join the{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{info.orgName}</strong> workspace on ClickUp Sync.
          </p>
          <div style={{ marginTop: 12 }}>
            <Pill tone="purple" icon={<Shield size={11} />}>Joining as {ROLE_LABEL[info.role] ?? info.role}</Pill>
          </div>
        </div>

        {/* Set up account */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 18 }}>
          <AuthField label="Email" type="email" icon={Mail} value={info.email} readOnly />
          <AuthField label="Your name" icon={User} autoComplete="name" autoFocus
            value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Jane Cooper" />
          <AuthField label="Create a password" type="password" icon={Lock} autoComplete="new-password"
            value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="At least 10 characters"
            hint="You'll use this to sign in next time."
            error={error || undefined} />
          <AuthSubmit loading={loading}>Accept invitation &amp; join</AuthSubmit>
        </form>
        <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', margin: '16px 0 0' }}>
          Not you, or didn't expect this?{' '}
          <button onClick={() => setDeclined(true)} style={{ background: 'none', border: 0, padding: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}>Decline</button>
        </p>
      </AuthCard>
      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-faint)', marginTop: 16, lineHeight: 1.5 }}>
        This invitation was sent to {info.email}.<br />It expires 7 days after it was sent.
      </p>
    </AuthShell>
  );
}
