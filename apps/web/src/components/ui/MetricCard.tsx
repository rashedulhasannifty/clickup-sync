import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Sparkline } from './Sparkline';

interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  delta?: React.ReactNode;
  deltaTone?: 'up' | 'down' | 'neutral';
  trend?: number[];
  icon?: React.ReactNode;
  accent?: boolean;
  dense?: boolean;
  onClick?: () => void;
}

export function MetricCard({ label, value, sublabel, delta, deltaTone, trend, icon, accent, dense, onClick }: MetricCardProps) {
  const deltaColor = deltaTone === 'up' ? 'var(--green)' : deltaTone === 'down' ? 'var(--red)' : 'var(--text-muted)';
  const Tag = (onClick ? 'button' : 'div') as React.ElementType;
  const valueFontSize = dense ? 22 : 26;
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      style={{
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: dense ? '12px 14px' : '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: dense ? 4 : 6,
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 120ms',
        width: '100%',
      }}
    >
      {accent && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'var(--accent-grad)',
          opacity: 0.06, pointerEvents: 'none',
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        {icon && <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, position: 'relative' }}>
        <span style={{ fontSize: valueFontSize, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        {sublabel && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sublabel}</span>}
      </div>
      {(delta || trend) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
          {delta && (
            typeof delta === 'string' ? (
              <span style={{ fontSize: 11, fontWeight: 600, color: deltaColor, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {deltaTone === 'up' && <TrendingUp size={12} />}
                {deltaTone === 'down' && <TrendingDown size={12} />}
                {delta}
              </span>
            ) : (
              <div style={{ marginTop: 4 }}>{delta}</div>
            )
          )}
          {trend && <Sparkline data={trend} color="var(--accent)" />}
        </div>
      )}
    </Tag>
  );
}
