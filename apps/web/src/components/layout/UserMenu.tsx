import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Users, ChevronDown } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../hooks/useAuth';

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' };

/** Top-bar account control: avatar button opening a dropdown (identity + sign out). */
export function UserMenu() {
  const { user, org, hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!user?.email) return null;
  const roleLabel = user.role ? (ROLE_LABEL[user.role] ?? user.role) : null;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        className="btn-3d"
        onClick={() => setOpen((o) => !o)}
        title={user.email}
        style={{
          ['--b-edge' as string]: 'var(--border-strong)',
          ['--b-glow' as string]: 'var(--btn-neutral-glow)',
          ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
          display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 4px 0 2px',
          border: '1px solid transparent', background: 'transparent', borderRadius: 999, cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Avatar name={user.email} size={28} />
        <ChevronDown size={13} style={{ color: 'var(--text-faint)' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50, width: 232,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11,
          padding: 6, boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)', marginBottom: 4 }}>
            <Avatar name={user.email} size={34} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {roleLabel}{org?.name ? ` · ${org.name}` : ''}
              </div>
            </div>
          </div>

          {hasRole('ADMIN') && (
            <button
              type="button"
              className="row-3d"
              onClick={() => { setOpen(false); navigate('/team'); }}
              style={menuItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Users size={14} style={{ color: 'var(--text-muted)' }} /> Manage team
            </button>
          )}

          <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 6px' }} />

          <button
            type="button"
            className="row-3d"
            onClick={() => { setOpen(false); void logout(); }}
            style={menuItemStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={14} style={{ color: 'var(--text-muted)' }} /> Sign out
          </button>
        </div>
      )}
    </span>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
  border: 0, background: 'transparent', borderRadius: 7, cursor: 'pointer',
  fontSize: 13, color: 'var(--text)', textAlign: 'left',
};
