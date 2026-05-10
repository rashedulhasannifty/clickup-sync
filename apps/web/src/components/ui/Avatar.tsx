function nameToColor(name: string): string {
  const colors = ['#7B68EE','#10b981','#f59e0b','#3b82f6','#ef4444','#8b5cf6','#06b6d4','#ec4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

const SIZES = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-sm', lg: 'w-10 h-10 text-base' };

export function Avatar({ name, size = 'md', color }: AvatarProps) {
  const bg = color ?? nameToColor(name);
  const initials = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white flex-shrink-0 ${SIZES[size]}`}
      style={{ background: bg }}
      title={name}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - max;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} size="sm" />
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--muted-bg)] text-[var(--text-muted)] text-xs font-medium border border-[var(--surface)]">
          +{extra}
        </span>
      )}
    </div>
  );
}
