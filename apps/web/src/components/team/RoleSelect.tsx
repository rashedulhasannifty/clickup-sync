import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Shield, Users, ChevronDown, ChevronsUpDown, Check, type LucideIcon } from 'lucide-react';
import { Pill } from '../ui/Pill';
import type { Role } from '../../api/auth';

type Tone = 'purple' | 'blue' | 'gray';

interface RoleMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  desc: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  OWNER: {
    label: 'Owner',
    tone: 'purple',
    icon: ShieldCheck,
    desc: 'Full access, including organization connection secrets and member management.',
  },
  ADMIN: {
    label: 'Admin',
    tone: 'blue',
    icon: Shield,
    desc: 'Manage members, rates, sync configuration, and run backfills.',
  },
  MEMBER: {
    label: 'Member',
    tone: 'gray',
    icon: Users,
    desc: 'Read-only access to dashboards and reports.',
  },
};

export const ALL_ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER'];

interface RoleSelectProps {
  value: Role;
  onChange: (role: Role) => void;
  /** Which roles can be picked. Defaults to all three. */
  roles?: Role[];
  disabled?: boolean;
  /** 'pill' = inline table chip; 'select' = full-width form control. */
  variant?: 'pill' | 'select';
  align?: 'left' | 'right';
  width?: number;
}

export function RoleSelect({
  value,
  onChange,
  roles = ALL_ROLES,
  disabled,
  variant = 'pill',
  align = 'left',
  width = 260,
}: RoleSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  // Position the menu with fixed coords from the trigger's rect so it can escape
  // any scrollable/overflow-clipped ancestor (e.g. the Modal body, the Drawer).
  useLayoutEffect(() => {
    if (!open || !ref.current) { setCoords(null); return; }
    const r = ref.current.getBoundingClientRect();
    const w = variant === 'select' ? Math.max(width, r.width) : width;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setCoords({ top: r.bottom + 6, left, width: w });
  }, [open, align, width, variant]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true); // capture: catches inner scrollers
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const meta = ROLE_META[value];
  const Icon = meta.icon;

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: variant === 'select' ? 'block' : 'inline-flex' }}
      onClick={(e) => e.stopPropagation()}
    >
      {variant === 'pill' ? (
        <button
          type="button"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 6px 3px 8px',
            borderRadius: 7,
            border: '1px solid transparent',
            background: 'transparent',
            cursor: disabled ? 'default' : 'pointer',
            transition: 'background 100ms',
          }}
          onMouseEnter={(e) => {
            if (!disabled) e.currentTarget.style.background = 'var(--hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Pill tone={meta.tone} size="sm">
            {meta.label}
          </Pill>
          {!disabled && <ChevronDown size={13} style={{ color: 'var(--text-faint)' }} />}
        </button>
      ) : (
        <button
          type="button"
          className="btn-3d"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          style={{
            ['--b-edge' as string]: 'var(--border-strong)',
            ['--b-glow' as string]: 'var(--btn-neutral-glow)',
            ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            height: 42,
            padding: '0 12px',
            fontSize: 14,
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            borderRadius: 9,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            justifyContent: 'space-between',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon size={15} style={{ color: 'var(--text-muted)' }} />
            {meta.label}
          </span>
          <ChevronsUpDown size={15} style={{ color: 'var(--text-faint)' }} />
        </button>
      )}
      {open && !disabled && coords && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            width: coords.width,
            maxHeight: 'min(60vh, 360px)',
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 11,
            padding: 6,
            boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
          }}
        >
          {roles.map((r) => {
            const m = ROLE_META[r];
            const Ic = m.icon;
            const sel = r === value;
            return (
              <button
                type="button"
                className="row-3d"
                key={r}
                onClick={() => {
                  onChange(r);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  width: '100%',
                  padding: '9px 10px',
                  textAlign: 'left',
                  border: 0,
                  borderRadius: 8,
                  background: sel ? 'var(--accent-soft)' : 'transparent',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!sel) e.currentTarget.style.background = 'var(--hover)';
                }}
                onMouseLeave={(e) => {
                  if (!sel) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    marginTop: 1,
                    color: sel ? 'var(--accent-strong)' : 'var(--text-muted)',
                    display: 'flex',
                  }}
                >
                  <Ic size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text)',
                    }}
                  >
                    {m.label}
                    {sel && <Check size={13} style={{ color: 'var(--accent-strong)' }} />}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11.5,
                      color: 'var(--text-muted)',
                      lineHeight: 1.45,
                      marginTop: 1,
                    }}
                  >
                    {m.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
}
