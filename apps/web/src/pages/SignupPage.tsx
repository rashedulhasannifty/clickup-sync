import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Mail, Lock, Building2 } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import {
  AuthShell, AuthCard, AuthHeading, AuthField, AuthSubmit, SSOButton, Divider,
  PasswordStrength, BrandMark,
} from '../components/auth/AuthShell';

export function SignupPage() {
  const [form, setForm] = useState({ orgName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
      setError(err?.response?.status === 409
        ? 'Signup is closed — ask an admin for an invite.'
        : 'Could not create your account.');
      setLoading(false);
    }
  }

  return (
    <AuthShell maxWidth={432}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><BrandMark /></div>
      <AuthCard>
        <AuthHeading title="Create your account" subtitle="Set up a workspace to start syncing ClickUp data." />
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SSOButton>Sign up with Google</SSOButton>
          <Divider label="or" />
          <AuthField label="Full name" icon={User} autoComplete="name" autoFocus
            value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Jane Cooper" />
          <AuthField label="Work email" type="email" icon={Mail} autoComplete="email"
            value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@company.com" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <AuthField label="Password" type="password" icon={Lock} autoComplete="new-password"
              value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Create a password" />
            <PasswordStrength value={form.password} />
          </div>
          <AuthField label="Workspace name" icon={Building2}
            value={form.orgName} onChange={(e) => update('orgName', e.target.value)} placeholder="Acme Co"
            hint="You can rename this later in Settings."
            error={error || undefined} />
          <AuthSubmit loading={loading}>Create account</AuthSubmit>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
            By creating an account you agree to our Terms of Service and Privacy Policy.
          </p>
        </form>
      </AuthCard>
      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 18 }}>
        Already have an account?{' '}
        <button onClick={() => navigate('/login')} style={{ background: 'none', border: 0, padding: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)', cursor: 'pointer' }}>Sign in</button>
      </p>
    </AuthShell>
  );
}
