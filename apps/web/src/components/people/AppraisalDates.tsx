import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { AppraisalView, UpdateAppraisalBody } from '../../api/appraisals';
import { dateRangeText, timingSentence } from '../../lib/appraisals';
import { formatDate } from '../../lib/people';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { TimingChip } from './AppraisalBits';

/**
 * The appraisal's own dates: due date, review period and timing ("Due 15 Jan 2026 · signed off
 * 3 Mar 2026 (47 days late)"). Before sign-off an admin can adjust them: the due date moves
 * freely (early or late; the next due date still comes from the join date), the period must end
 * on or before it and not start before joining. Changing the period recomputes the KPIs.
 */
export function AppraisalDatesCard({
  view,
  busy,
  onSave,
}: {
  view: AppraisalView;
  busy: boolean;
  /** Saves the date fields (the parent saves any other pending edits first). */
  onSave: (body: UpdateAppraisalBody) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [dueDate, setDueDate] = useState(view.dueDate ?? '');
  const [periodStart, setPeriodStart] = useState(view.periodStart);
  const [periodEnd, setPeriodEnd] = useState(view.periodEnd);
  const [error, setError] = useState('');
  const canEdit = view.editableFields.includes('dueDate');
  const sentence = timingSentence(view.dueDate, view.signedOffAt, view.timing);

  function reset() {
    setDueDate(view.dueDate ?? '');
    setPeriodStart(view.periodStart);
    setPeriodEnd(view.periodEnd);
    setError('');
    setEditing(false);
  }

  async function save() {
    if (!periodStart || !periodEnd) return setError('Both review period dates are required.');
    if (periodStart > periodEnd) return setError('The review period must start on or before it ends.');
    if (dueDate && periodEnd > dueDate) return setError('The review period must end on or before the due date.');
    setError('');
    const body: UpdateAppraisalBody = {};
    if (dueDate && dueDate !== view.dueDate) body.dueDate = dueDate;
    if (periodStart !== view.periodStart) body.periodStart = periodStart;
    if (periodEnd !== view.periodEnd) body.periodEnd = periodEnd;
    if (Object.keys(body).length === 0) return setEditing(false);
    if (await onSave(body)) setEditing(false);
  }

  return (
    <Card
      title="Dates"
      action={
        canEdit && !editing ? (
          <Button size="sm" variant="ghost" icon={<CalendarClock size={13} />} disabled={busy} onClick={() => setEditing(true)}>
            Adjust dates
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Due date" hint="Counted from the join date. Moving it does not move the next due date.">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 10 }}>
            <Field label="Reviews from">
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={busy} />
            </Field>
            <Field label="to">
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={busy} />
            </Field>
          </div>
          {view.kpiSnapshot && (periodStart !== view.periodStart || periodEnd !== view.periodEnd) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>The KPIs are recomputed over the new period when you save.</div>
          )}
          {error && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" type="button" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" type="button" variant="accent" loading={busy} onClick={save}>
              Save dates
            </Button>
          </div>
        </div>
      ) : (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 13 }}>
          <dt style={{ color: 'var(--text-muted)' }}>Due</dt>
          <dd style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {view.dueDate ? formatDate(view.dueDate) : <span style={{ color: 'var(--text-faint)' }}>No due date (calendar cycle)</span>}
            <TimingChip timing={view.timing} />
          </dd>
          <dt style={{ color: 'var(--text-muted)' }}>Reviews</dt>
          <dd style={{ margin: 0 }}>{dateRangeText(view.periodStart, view.periodEnd)}</dd>
          {sentence && (
            <dd style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{sentence}</dd>
          )}
        </dl>
      )}
    </Card>
  );
}
