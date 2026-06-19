import { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useSpikeNoticePreview, useNotifySpike, type HourSpikeWatchRow } from '../hooks/useReports';

export function NotifySpikeModal({ row, onClose }: { row: HourSpikeWatchRow; onClose: () => void }) {
  const preview = useSpikeNoticePreview(row.userId, row.date);
  const notify = useNotifySpike();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const p = preview.data;
  const noEmail = !!p && !p.recipientEmail;
  const already = !!p?.alreadyNotified;

  async function send() {
    setError(null);
    try {
      await notify.mutateAsync({
        userId: row.userId,
        date: row.date,
        rule: row.rule,
        median: row.median,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to send. Please try again.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Notify ${row.userName}`}
      subtitle={`${row.date} · ${row.hours.toFixed(1)}h logged`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="caution"
            size="sm"
            loading={notify.isPending}
            disabled={preview.isLoading || preview.isError || noEmail || already}
            onClick={() => void send()}
          >
            Send email
          </Button>
        </div>
      }
    >
      {preview.isLoading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading breakdown…</div>}
      {preview.isError && <div style={{ fontSize: 13, color: 'var(--red)' }}>Couldn't load the breakdown.</div>}
      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13 }}>
            To: <strong>{p.recipientEmail ?? '— no email on file —'}</strong>
          </div>
          {noEmail && (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>
              This member has no email address on their time entries, so we can't send.
            </div>
          )}
          {already && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Already notified for this day.
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Tasks that day</div>
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
              {p.tasks.map((t, i) => (
                <div
                  key={t.taskId || i}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 10px', fontSize: 13,
                    borderBottom: i < p.tasks.length - 1 ? '1px solid var(--border-soft)' : 0,
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskName}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.hours.toFixed(2)}h</span>
                </div>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Add context for the member…"
              style={{
                fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical',
              }}
            />
          </label>
          {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        </div>
      )}
    </Modal>
  );
}
