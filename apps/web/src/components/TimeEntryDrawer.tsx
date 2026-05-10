import { useNavigate } from 'react-router-dom';
import { fmt } from '../lib/formatters';
import { Drawer } from './ui/Drawer';
import { Avatar } from './ui/Avatar';
import { Pill } from './ui/Pill';
import { Callout } from './ui/Callout';
import { Button } from './ui/Button';

export interface TimeEntryItem {
  timeEntryId: string;
  taskId: string;
  taskName: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  startTime: string;
  endTime: string | null;
  durationHours: number;
  hourlyRateCents: number;
  costAud: number;
  status: string;
  billable: boolean;
  description: string | null;
  syncedAt: string | null;
}

interface TimeEntryDrawerProps {
  entry: TimeEntryItem | null;
  onClose: () => void;
}

export function TimeEntryDrawer({ entry, onClose }: TimeEntryDrawerProps) {
  const navigate = useNavigate();

  return (
    <Drawer open={entry !== null} onClose={onClose} title="Time Entry" width={520}>
      {entry && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Section 1: Assignee */}
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={entry.userName} size="lg" />
                <div>
                  <p style={{ fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                    {entry.userName}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    {entry.userEmail}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/assignee-rates')}
              >
                View Rates →
              </Button>
            </div>
          </div>

          {/* Section 2: Time */}
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            <p
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              Time
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
              }}
            >
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                  Start
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>
                  {fmt.dateTime(entry.startTime)}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                  End
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>
                  {entry.endTime ? fmt.dateTime(entry.endTime) : '—'}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                  Duration
                </p>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                  {fmt.hours(entry.durationHours)}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 2px' }}>
                  Billable
                </p>
                <Pill tone={entry.billable ? 'green' : 'gray'}>
                  {entry.billable ? 'Billable' : 'Non-billable'}
                </Pill>
              </div>
            </div>
          </div>

          {/* Section 3: Cost */}
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            <p
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                marginBottom: 12,
              }}
            >
              Cost
            </p>
            {entry.status === 'COST_CALCULATED' ? (
              <Callout tone="success">
                {fmt.hours(entry.durationHours)} &times; ${(entry.hourlyRateCents / 100).toFixed(0)}/h ={' '}
                {fmt.money(entry.costAud * 100)}
              </Callout>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Callout tone="warning">
                  No rate found for this date range.
                </Callout>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/assignee-rates')}
                  >
                    Add Rate
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Description */}
          {entry.description && (
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border-soft)',
              }}
            >
              <p
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-muted)',
                  marginBottom: 8,
                }}
              >
                Description
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0, lineHeight: 1.6 }}>
                {entry.description}
              </p>
            </div>
          )}

          {/* Section 5: Sync metadata */}
          <div style={{ padding: '20px 24px' }}>
            <p
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              Sync Metadata
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Entry ID</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text)' }}>
                  {entry.timeEntryId}
                </span>
              </div>
              {entry.syncedAt && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Synced</span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
                    {fmt.relative(entry.syncedAt)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
