import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../api/auth';
import { useToast } from '../components/ui/Toast';

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' };

function axiosMessage(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/** Every signed-in user's own account page — Settings is Admin-only, so the
 *  change-password form can't live there. */
export function AccountPage() {
  const { user, org } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !next) { setError('Fill in both passwords.'); return; }
    // Match the backend policy (@MinLength(10)) before the API round-trip.
    if (next.length < 10) { setError('Your new password must be at least 10 characters.'); return; }
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    setSaving(true);
    setError('');
    try {
      await authApi.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      toast.success('Password changed. Any other signed-in devices were signed out.');
    } catch (err) {
      setError(axiosMessage(err, 'Could not change your password.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader title="Account" description="Your sign-in details for this workspace." />

      <Card title="Profile">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={user?.email ?? ''} size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{user?.email}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{org?.name}</div>
          </div>
          {user?.role && <Pill tone="gray">{ROLE_LABEL[user.role] ?? user.role}</Pill>}
        </div>
      </Card>

      <Card title="Change password" subtitle="Setting a new password signs you out on every other device.">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380 }}>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current}
              onChange={(e) => { setCurrent(e.target.value); setError(''); }} />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <Input type="password" autoComplete="new-password" value={next}
              onChange={(e) => { setNext(e.target.value); setError(''); }} />
          </Field>
          <Field label="Confirm new password" error={error || undefined}>
            <Input type="password" autoComplete="new-password" value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(''); }} />
          </Field>
          <div>
            <Button type="submit" loading={saving} icon={saving ? undefined : <KeyRound size={13} />}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
