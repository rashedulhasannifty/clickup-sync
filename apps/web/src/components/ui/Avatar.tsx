import { useEffect, useState } from 'react';

function nameToColor(name: string): string {
  const colors = ['#7B68EE', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

interface UserObj { name: string; color?: string; initials?: string; image?: string | null }

interface AvatarProps {
  name?: string;
  user?: UserObj;
  size?: 'sm' | 'md' | 'lg' | number;
  color?: string;
  image?: string | null;
}

function getPixelSize(size: AvatarProps['size']): number {
  if (typeof size === 'number') return size;
  if (size === 'sm') return 24;
  if (size === 'lg') return 40;
  return 32;
}

export function Avatar({ name, user, size = 'md', color, image }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolvedName = user?.name ?? name ?? '?';
  const bg = color ?? user?.color ?? nameToColor(resolvedName);
  const initials = user?.initials ?? resolvedName.split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2);
  const px = getPixelSize(size);
  const fontSize = px <= 24 ? 10 : px <= 32 ? 12 : 14;
  const src = image ?? user?.image ?? null;

  // Reset the failed flag when the source changes, so a reused (e.g. index-keyed
  // in AvatarStack) instance retries the new image instead of staying on initials.
  useEffect(() => { setImgFailed(false); }, [src]);

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt={resolvedName}
        title={resolvedName}
        onError={() => setImgFailed(true)}
        style={{
          width: px, height: px, borderRadius: 999,
          objectFit: 'cover', flexShrink: 0, display: 'inline-block',
        }}
      />
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: px, height: px, borderRadius: 999,
        background: bg, color: '#fff',
        fontSize, fontWeight: 700, flexShrink: 0,
        letterSpacing: '-0.02em',
      }}
      title={resolvedName}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ names, users, max = 3 }: { names?: string[]; users?: UserObj[]; max?: number }) {
  const items: UserObj[] = users ?? (names ?? []).map(n => ({ name: n }));
  const shown = items.slice(0, max);
  const extra = items.length - max;
  return (
    <div style={{ display: 'flex', marginLeft: 4 }}>
      {shown.map((u, i) => (
        <span key={i} style={{ marginLeft: -6 }}>
          <Avatar user={u} size={24} />
        </span>
      ))}
      {extra > 0 && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, borderRadius: 999,
          background: 'var(--muted-bg)', color: 'var(--text-muted)',
          fontSize: 10, fontWeight: 600,
          border: '1px solid var(--surface)', marginLeft: -6,
        }}>+{extra}</span>
      )}
    </div>
  );
}
