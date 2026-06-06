import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { AuthShell, AuthField, PasswordField, AuthButton, AuthError } from '../components/auth/AuthShell';

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
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to ClickUp Sync"
      footer={
        <p className="text-xs text-[var(--text-muted)]">
          First time here?{' '}
          <Link to="/signup" className="font-medium text-[var(--accent)] hover:underline">
            Set up your organization →
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AuthField
          label="Email"
          icon={Mail}
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
        />
        <PasswordField
          label="Password"
          icon={Lock}
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Enter your password"
          autoComplete="current-password"
        />
        <AuthError message={error} />
        <AuthButton type="submit" loading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
