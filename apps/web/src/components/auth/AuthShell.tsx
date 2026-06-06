import React, { useState } from 'react';
import { Sun, Moon, Eye, EyeOff, ArrowRight, Loader2, type LucideIcon } from 'lucide-react';

// ── Brand mark ────────────────────────────────────────────────────────────────
export function BrandMark({ size = 34, showText = true, sub = 'operations console' }: {
  size?: number; showText?: boolean; sub?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <div style={{
        width: size, height: size, borderRadius: size * 0.26, flexShrink: 0,
        background: 'var(--accent-grad)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: size * 0.46, fontWeight: 700, letterSpacing: '-0.02em',
        boxShadow: '0 3px 10px rgba(123, 104, 238, 0.34)',
      }}>C</div>
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>ClickUp Sync</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>{sub}</span>
        </div>
      )}
    </div>
  );
}

// ── Auth shell (soft neutral bg, centered card, theme toggle, footer) ───────────
export function AuthShell({ children, maxWidth = 416 }: {
  children: React.ReactNode; maxWidth?: number;
}) {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark',
  );
  function toggleTheme() {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    setIsDark(!isDark);
  }
  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'var(--page-bg)',
      backgroundImage: isDark
        ? 'radial-gradient(900px 480px at 50% -8%, rgba(123,104,238,0.16), transparent 70%)'
        : 'radial-gradient(900px 480px at 50% -8%, rgba(123,104,238,0.10), transparent 70%)',
      padding: 24, position: 'relative',
    }}>
      <button onClick={toggleTheme} title={isDark ? 'Light mode' : 'Dark mode'} style={{
        position: 'absolute', top: 20, right: 22,
        width: 34, height: 34, border: '1px solid var(--border)',
        background: 'var(--surface)', color: 'var(--text)',
        borderRadius: 8, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '40px 0' }}>
        <div style={{ width: '100%', maxWidth, animation: 'authIn 360ms cubic-bezier(0.16,1,0.3,1)' }}>
          {children}
        </div>
      </div>

      <footer style={{ fontSize: 11.5, color: 'var(--text-faint)', display: 'flex', gap: 16, paddingBottom: 4 }}>
        <span>© 2026 Nifty</span>
        <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
        <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'inherit', textDecoration: 'none' }}>Terms</a>
        <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'inherit', textDecoration: 'none' }}>Help</a>
      </footer>
    </div>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: '28px 30px 30px',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 18px 50px -22px rgba(15,23,42,0.22)',
    }}>{children}</div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{subtitle}</p>}
    </div>
  );
}

// ── Labeled field with a tall input + reveal toggle for passwords ───────────────
export function AuthField({
  label, type = 'text', value, onChange, placeholder, icon, autoFocus, readOnly,
  hint, right, error, name, autoComplete,
}: {
  label?: string;
  type?: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  icon?: LucideIcon;
  autoFocus?: boolean;
  readOnly?: boolean;
  hint?: string;
  right?: React.ReactNode;
  error?: string;
  name?: string;
  autoComplete?: string;
}) {
  const [reveal, setReveal] = useState(false);
  const isPw = type === 'password';
  const inputType = isPw ? (reveal ? 'text' : 'password') : type;
  const Icon = icon;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {(label || right) && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          {label && <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{label}</label>}
          {right}
        </div>
      )}
      <div style={{ position: 'relative', display: 'flex' }}>
        {Icon && (
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', display: 'flex', pointerEvents: 'none' }}>
            <Icon size={15} />
          </span>
        )}
        <input
          name={name}
          type={inputType}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
          readOnly={readOnly}
          autoComplete={autoComplete}
          style={{
            width: '100%', height: 42,
            padding: `0 ${isPw ? 40 : 12}px 0 ${Icon ? 38 : 12}px`,
            fontSize: 14,
            background: readOnly ? 'var(--muted-bg)' : 'var(--surface)',
            color: readOnly ? 'var(--text-muted)' : 'var(--text)',
            border: `1px solid ${error ? 'var(--red)' : 'var(--border-strong)'}`,
            borderRadius: 9, outline: 'none',
            transition: 'border-color 120ms, box-shadow 120ms',
          }}
          onFocus={(e) => { if (!readOnly && !error) { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; } }}
          onBlur={(e) => { e.target.style.borderColor = error ? 'var(--red)' : 'var(--border-strong)'; e.target.style.boxShadow = 'none'; }}
        />
        {isPw && (
          <button type="button" onClick={() => setReveal((r) => !r)} tabIndex={-1} aria-label={reveal ? 'Hide password' : 'Show password'} style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            width: 28, height: 28, border: 0, background: 'transparent',
            color: 'var(--text-faint)', cursor: 'pointer', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {error
        ? <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</span>
        : hint && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

// ── Big primary submit (with loading + trailing arrow) ──────────────────────────
export function AuthSubmit({ children, loading, disabled }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean;
}) {
  const off = loading || disabled;
  return (
    <button type="submit" disabled={off} style={{
      width: '100%', height: 44, marginTop: 2,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      background: disabled ? 'var(--border-strong)' : 'var(--accent)', color: '#fff',
      border: 0, borderRadius: 9, fontSize: 14, fontWeight: 600,
      cursor: off ? 'default' : 'pointer',
      boxShadow: disabled ? 'none' : '0 2px 8px rgba(123,104,238,0.32)',
      transition: 'background 120ms, opacity 120ms', opacity: loading ? 0.85 : 1,
    }}
      onMouseEnter={(e) => { if (!off) e.currentTarget.style.background = 'var(--accent-hover)'; }}
      onMouseLeave={(e) => { if (!off) e.currentTarget.style.background = 'var(--accent)'; }}>
      {loading
        ? <Loader2 size={17} style={{ animation: 'spin 0.7s linear infinite' }} />
        : <>{children}<ArrowRight size={16} /></>}
    </button>
  );
}

// ── SSO button (no OAuth backend yet → rendered disabled "coming soon") ─────────
function GoogleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" /><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" /></svg>
  );
}

export function SSOButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" disabled title="Single sign-on is coming soon" style={{
      width: '100%', height: 42, position: 'relative',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
      background: 'var(--surface)', color: 'var(--text-muted)',
      border: '1px solid var(--border-strong)', borderRadius: 9,
      fontSize: 13.5, fontWeight: 600, cursor: 'not-allowed', opacity: 0.7,
    }}>
      <GoogleGlyph />{children}
      <span style={{
        position: 'absolute', right: 10, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: 'var(--text-faint)',
        background: 'var(--muted-bg)', borderRadius: 5, padding: '2px 5px',
      }}>Soon</span>
    </button>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── Password strength meter ─────────────────────────────────────────────────────
function pwStrength(pw: string): number {
  let s = 0;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0..4
}

export function PasswordStrength({ value }: { value: string }) {
  const strength = pwStrength(value);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', 'var(--red)', 'var(--amber)', 'var(--blue)', 'var(--green)'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
      <div style={{ flex: 1, display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: i <= strength ? colors[strength] : 'var(--border)', transition: 'background 150ms' }} />
        ))}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: strength ? colors[strength] : 'var(--text-faint)', minWidth: 42, textAlign: 'right' }}>
        {labels[strength] || '—'}
      </span>
    </div>
  );
}
