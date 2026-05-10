import React from 'react';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  badge,
}: {
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      {breadcrumb && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{breadcrumb}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: 720 }}>
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
