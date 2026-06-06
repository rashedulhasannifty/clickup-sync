import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, User, Mail, Lock } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { AuthShell, AuthField, PasswordField, AuthButton, AuthError } from '../components/auth/AuthShell';

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
    <AuthShell
      title="Set up your organization"
      subtitle="Create the owner account"
      icon={Building2}
      footer={
        <p className="text-xs text-[var(--text-muted)]">
          <Link to="/login" className="font-medium text-[var(--accent)] hover:underline">
            ← Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AuthField
          label="Organization name"
          icon={Building2}
          type="text"
          value={form.orgName}
          onChange={(e) => update('orgName', e.target.value)}
          placeholder="Acme Inc."
          autoComplete="organization"
          autoFocus
        />
        <AuthField
          label="Your name"
          icon={User}
          type="text"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g. Rashedul"
          autoComplete="name"
        />
        <AuthField
          label="Email"
          icon={Mail}
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
        <PasswordField
          label="Password"
          icon={Lock}
          value={form.password}
          onChange={(e) => update('password', e.target.value)}
          placeholder="Create a password"
          autoComplete="new-password"
          hint="At least 10 characters"
        />
        <AuthError message={error} />
        <AuthButton type="submit" loading={loading}>
          {loading ? 'Creating…' : 'Create organization'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
