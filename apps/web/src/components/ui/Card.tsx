import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  padding?: number | boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Card({ children, title, subtitle, action, className = '', padding = 16, onClick, style }: CardProps) {
  const pad = padding === true ? 16 : padding === false ? 0 : padding;
  // When a consumer explicitly asks the card to let content overflow (e.g. a
  // row with an absolutely-positioned dropdown menu that needs to escape the
  // card bounds), the inner body must not clip/scroll either — otherwise the
  // popover triggers a spurious scrollbar on the card body.
  const bodyOverflowY = style?.overflow === 'visible' ? 'visible' : 'auto';
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        cursor: onClick ? 'pointer' : undefined,
        // Flex column so the body can grow to fill a parent-given height (e.g.
        // a fixed-height grid row). When the card height is auto this is inert.
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {(title || action) && (
        <div style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)', gap: 8,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {title && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
      )}
      <div style={{ padding: pad, flex: 1, minHeight: 0, overflowY: bodyOverflowY }}>{children}</div>
    </div>
  );
}
