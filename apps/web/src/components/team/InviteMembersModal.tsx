import { useState } from 'react';
import { Mail, X, Plus, Info, Send } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { RoleSelect } from './RoleSelect';
import type { Role } from '../../api/auth';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface InviteRow {
  email: string;
  role: Role;
}

export interface InvitePayload {
  email: string;
  role: Role;
}

/** Roles assignable on invite — no OWNER (ownership transfer is a separate flow). */
const INVITE_ROLES: Role[] = ['ADMIN', 'MEMBER'];

export function InviteMembersModal({
  onClose,
  onSend,
  existing = [],
  sending = false,
}: {
  onClose: () => void;
  onSend: (invites: InvitePayload[]) => void;
  /** Already-member or already-invited emails (lowercased comparison). */
  existing?: string[];
  sending?: boolean;
}) {
  const [rows, setRows] = useState<InviteRow[]>([{ email: '', role: 'MEMBER' }]);
  const [touched, setTouched] = useState(false);
  const existLower = existing.map((e) => e.toLowerCase());

  const setRow = (i: number, patch: Partial<InviteRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { email: '', role: 'MEMBER' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const errorFor = (r: InviteRow, i: number): string | null => {
    const e = r.email.trim().toLowerCase();
    if (!e) return 'empty';
    if (!EMAIL_RE.test(e)) return 'Enter a valid email address';
    if (existLower.includes(e)) return 'Already a member or invited';
    if (rows.findIndex((x) => x.email.trim().toLowerCase() === e) !== i) return 'Duplicate email';
    return null;
  };

  const filled = rows.filter((r) => r.email.trim());
  const allValid =
    filled.length > 0 &&
    filled.every((r) => {
      const i = rows.indexOf(r);
      return !errorFor(r, i);
    });

  const send = () => {
    setTouched(true);
    if (!allValid) return;
    onSend(filled.map((r) => ({ email: r.email.trim(), role: r.role })));
  };

  return (
    <Modal
      onClose={onClose}
      width={540}
      title="Invite members"
      subtitle="They'll get an email invitation to join this workspace."
      onSubmit={send}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {filled.length > 0
              ? `${filled.length} ${filled.length === 1 ? 'person' : 'people'} to invite`
              : 'Add at least one email'}
          </span>
          <div style={{ flex: 1 }} />
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="success" icon={<Send size={13} />} disabled={!allValid} loading={sending}>
            Send {filled.length > 1 ? `${filled.length} invitations` : 'invitation'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* column labels */}
        <div style={{ display: 'flex', gap: 10, padding: '0 2px' }}>
          <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>Email address</span>
          <span style={{ width: 138, fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>Role</span>
          <span style={{ width: 28 }} />
        </div>

        {rows.map((r, i) => {
          const err = touched && r.email.trim() ? errorFor(r, i) : null;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 11,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-faint)',
                      display: 'flex',
                      pointerEvents: 'none',
                    }}
                  >
                    <Mail size={14} />
                  </span>
                  <input
                    type="email"
                    value={r.email}
                    autoFocus={i === 0}
                    aria-label={`Email address ${i + 1}`}
                    aria-invalid={err && err !== 'empty' ? true : undefined}
                    onChange={(e) => setRow(i, { email: e.target.value })}
                    placeholder="name@company.com"
                    className="input-3d"
                    style={{
                      width: '100%',
                      height: 40,
                      padding: '0 12px 0 34px',
                      fontSize: 13.5,
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      border: `1px solid ${err && err !== 'empty' ? 'var(--red)' : 'var(--border-strong)'}`,
                      borderRadius: 9,
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div style={{ width: 138 }}>
                  <RoleSelect variant="select" value={r.role} roles={INVITE_ROLES} width={240} onChange={(role) => setRow(i, { role })} />
                </div>
                <button
                  type="button"
                  aria-label={`Remove email ${i + 1}`}
                  className="btn-3d"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  style={{
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    border: 0,
                    background: 'transparent',
                    color: rows.length === 1 ? 'var(--border-strong)' : 'var(--text-faint)',
                    borderRadius: 9,
                    cursor: rows.length === 1 ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    ['--b-edge' as string]: 'transparent',
                    ['--b-glow' as string]: 'transparent',
                    ['--b-glow-strong' as string]: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (rows.length > 1) e.currentTarget.style.background = 'var(--hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <X size={15} />
                </button>
              </div>
              {err && err !== 'empty' && (
                <span style={{ fontSize: 11.5, color: 'var(--red)', paddingLeft: 2 }}>{err}</span>
              )}
            </div>
          );
        })}

        <div>
          <button
            type="button"
            className="btn-3d"
            onClick={addRow}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 4px',
              background: 'none',
              border: 0,
              color: 'var(--accent-strong)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              ['--b-edge' as string]: 'transparent',
              ['--b-glow' as string]: 'transparent',
              ['--b-glow-strong' as string]: 'transparent',
            }}
          >
            <Plus size={14} /> Add another
          </button>
        </div>

        <Callout tone="blue" icon={<Info size={13} />}>
          Roles set permissions inside Clicksy — <strong>Admins</strong> manage members &amp; settings,{' '}
          <strong>Members</strong> have read-only access to dashboards and reports.
        </Callout>
      </div>
    </Modal>
  );
}
