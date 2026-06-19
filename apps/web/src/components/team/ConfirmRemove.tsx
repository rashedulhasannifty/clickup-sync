import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

export interface RemoveTarget {
  id: string;
  /** Display name (or email-derived label). */
  label: string;
  pending: boolean;
}

export function ConfirmRemove({
  targets,
  onCancel,
  onConfirm,
  loading,
}: {
  targets: RemoveTarget[];
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
}) {
  const multi = targets.length > 1;
  const anyPending = targets.some((t) => t.pending);
  const allPending = targets.length > 0 && targets.every((t) => t.pending);
  const verb = allPending ? 'Revoke' : 'Remove';

  const title = allPending
    ? `Revoke ${multi ? `${targets.length} invitations` : 'invitation'}?`
    : `Remove ${multi ? `${targets.length} members` : targets[0]?.label || 'this member'}?`;

  const body = allPending
    ? 'They will no longer be able to use this invitation to join. You can re-invite them later.'
    : `They'll immediately lose access to this workspace and all its spaces. ${
        anyPending ? 'Pending invites in this selection will be revoked. ' : ''
      }This can't be undone.`;

  return (
    <Modal onClose={onCancel} width={440}>
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 10,
            background: 'var(--pill-red-bg)',
            color: 'var(--pill-red-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AlertTriangle size={19} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.55 }}>{body}</p>
          {multi && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {targets.slice(0, 6).map((t) => (
                <span
                  key={t.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px 3px 4px',
                    background: 'var(--muted-bg)',
                    borderRadius: 999,
                    fontSize: 12,
                  }}
                >
                  <Avatar name={t.label} size={18} />
                  {t.label}
                </span>
              ))}
              {targets.length > 6 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  +{targets.length - 6} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={13} />}
          loading={loading}
          onClick={onConfirm}
          style={{ boxShadow: 'none' }}
        >
          {verb}
          {multi ? ` ${targets.length}` : ''}
        </Button>
      </div>
    </Modal>
  );
}
