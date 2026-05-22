import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { Card } from './ui/Card';
import { fmt } from '../lib/formatters';
import { useAnomalies } from '../hooks/useReports';

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

export function AnomaliesPanel() {
  const navigate = useNavigate();
  const q = useAnomalies();
  const data = q.data;

  const rows: { key: string; title: string; subtitle: string; onClick: () => void }[] = [];

  if (data) {
    for (const s of data.dailySpikes) {
      rows.push({
        key: `daily-${s.date}`,
        title: `${formatDate(s.date)} was ${s.multiplier.toFixed(1)}× the 30-day median`,
        subtitle: `${moneyAud(s.totalCostAud)} vs ${moneyAud(s.medianAud)} typical`,
        onClick: () => navigate(dailyLink(s.date)),
      });
    }
    for (const s of data.clientSpikes) {
      rows.push({
        key: `client-${s.client}`,
        title: `${s.client} is up ${s.multiplier.toFixed(1)}× vs their 90-day baseline`,
        subtitle: `${moneyAud(s.lastWeekCostAud)} last 7d, ${moneyAud(s.baselineMedianAud)} typical weekly`,
        onClick: () => navigate(clientLink(s.client)),
      });
    }
  }

  return (
    <Card
      padding={0}
      title="Anomalies"
      subtitle="Daily spikes and per-client variance"
    >
      {q.isLoading && (
        <div style={{ padding: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 32, background: 'var(--muted-bg)', borderRadius: 6, marginBottom: 8, opacity: 0.6 }} />
          ))}
        </div>
      )}
      {q.isError && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>Couldn't load anomalies.</div>
          <button
            type="button"
            onClick={() => q.refetch()}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
            }}
          >Retry</button>
        </div>
      )}
      {data && rows.length === 0 && !q.isLoading && (
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No anomalies in the last 30 days.</p>
        </div>
      )}
      {data && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onClick}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 16px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--border-soft)' : 0,
                background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <span
                style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <TrendingUp size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function dailyLink(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
  const startMs = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
  const endMs = startMs + 86_400_000 - 1;
  const from = new Date(startMs).toISOString();
  const to   = new Date(endMs).toISOString();
  return `/time-entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function clientLink(client: string): string {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  return `/time-entries?from=${encodeURIComponent(weekAgo.toISOString())}&to=${encodeURIComponent(now.toISOString())}&search=${encodeURIComponent(client)}`;
}
