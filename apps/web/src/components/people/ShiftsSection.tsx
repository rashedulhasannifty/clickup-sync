import { useState } from 'react';
import { Check, Clock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ShiftSuggestion, ShiftView } from '../../api/people';
import {
  useAssignShifts,
  useCreateShift,
  useDeleteShift,
  useShifts,
  useShiftSuggestions,
  useUpdateShift,
} from '../../hooks/usePeople';
import { formatDateSpan, formatTimeOfDay, parseTimeOfDay } from '../../lib/people';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { Pill } from '../ui/Pill';
import { DataTable, type Column } from '../ui/DataTable';
import { useToast } from '../ui/Toast';
import { FormRow } from './FormBits';

function ShiftFormModal({ shift, onClose }: { shift?: ShiftView; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateShift();
  const update = useUpdateShift();
  const [name, setName] = useState(shift?.name ?? '');
  const [start, setStart] = useState(shift?.start ?? '09:30');
  const [end, setEnd] = useState(shift?.end ?? '18:30');
  const [grace, setGrace] = useState(String(shift?.graceMinutes ?? 15));
  const [tracked, setTracked] = useState(shift?.trackPunctuality ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  function submit() {
    const s = parseTimeOfDay(start);
    const e = parseTimeOfDay(end);
    if (!name.trim()) return setError('Name the shift.');
    if (s === null || e === null) return setError('Times are HH:MM (24-hour).');
    if (s === e) return setError('A shift must end at a different time than it starts.');
    if (!/^\d+$/.test(grace.trim()) || Number(grace) > 240) return setError('Grace is 0–240 minutes.');
    const body = { name: name.trim(), startMinutes: s, endMinutes: e, graceMinutes: Number(grace), trackPunctuality: tracked };
    const done = {
      onSuccess: () => {
        toast.success(shift ? `Saved ${body.name}.` : `Added ${body.name}.`);
        onClose();
      },
      onError: (err: unknown) => setError((err as Error).message),
    };
    if (shift) update.mutate({ id: shift.id, body }, done);
    else create.mutate(body, done);
  }

  return (
    <Modal
      onClose={onClose}
      title={shift ? 'Edit shift' : 'Add shift'}
      subtitle="Times are Dhaka time. An end before the start crosses midnight."
      width={480}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {error && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {error}
            </span>
          )}
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={pending} icon={<Check size={13} strokeWidth={2} />}>
            {shift ? 'Save' : 'Add shift'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Evening" />
        </Field>
        <FormRow>
          <Field label="Starts" required>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends" required>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Grace (minutes)" hint="Late means first entry after start + grace.">
            <Input inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
          </Field>
          <Field label="Track punctuality" hint="Off for irregular hours: no late badges, no punctuality KPI.">
            <div style={{ paddingTop: 6 }}>
              <Switch checked={tracked} onChange={setTracked} ariaLabel="Track punctuality" />
            </div>
          </Field>
        </FormRow>
      </div>
    </Modal>
  );
}

function SuggestionsModal({ shifts, onClose }: { shifts: ShiftView[]; onClose: () => void }) {
  const toast = useToast();
  const q = useShiftSuggestions(true);
  const assign = useAssignShifts();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const name = (id: string | null) => (id ? (shifts.find((s) => s.id === id)?.name ?? '—') : 'Default (09:30)');
  const rows = (q.data?.suggestions ?? []).filter((s) => s.changes && !accepted.has(s.employeeId));
  const unchanged = (q.data?.suggestions ?? []).filter((s) => !s.changes).length;

  function apply(list: ShiftSuggestion[]) {
    assign.mutate(
      list.map((s) => ({ employeeId: s.employeeId, shiftId: s.proposedShiftId })),
      {
        onSuccess: (r) => {
          setAccepted((prev) => new Set([...prev, ...list.map((s) => s.employeeId)]));
          toast.success(`Updated the shift of ${r.updated} employee${r.updated === 1 ? '' : 's'}.`);
        },
        onError: (e) => toast.error(`Couldn’t apply. ${(e as Error).message}`),
      },
    );
  }

  const columns: Column<ShiftSuggestion>[] = [
    { key: 'fullName', header: 'Employee', width: 180, render: (r) => r.fullName },
    {
      key: 'medianFirstIn',
      header: 'Usual first in',
      width: 130,
      render: (r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatTimeOfDay(r.medianFirstIn)}
          <span style={{ color: 'var(--text-faint)' }}> · {r.sampleDays}d</span>
          {r.irregular && (
            <span title={`Arrivals spread over ${r.spreadMinutes} minutes`} style={{ marginLeft: 6 }}>
              <Pill tone="amber" size="xs">
                irregular
              </Pill>
            </span>
          )}
        </span>
      ),
    },
    { key: 'currentShiftId', header: 'Now', width: 120, render: (r) => name(r.currentShiftId) },
    {
      key: 'proposedShiftName',
      header: 'Suggested',
      width: 140,
      render: (r) => (
        <span>
          {r.proposedShiftName}
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> ±{r.distanceMinutes}m</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 90,
      sortable: false,
      render: (r) => (
        <Button size="sm" variant="default" disabled={assign.isPending} onClick={() => apply([r])}>
          Accept
        </Button>
      ),
    },
  ];

  return (
    <Modal
      onClose={onClose}
      title="Suggested shifts"
      subtitle={
        q.data
          ? `From imported door data, ${formatDateSpan(q.data.period.from, q.data.period.to)}: each person’s median first entry on working days against the nearest shift start. Nothing changes until you accept.`
          : 'From imported door data. Nothing changes until you accept.'
      }
      width={720}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {unchanged > 0 ? `${unchanged} already on the suggested shift.` : ''}
          </span>
          <Button type="button" variant="default" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="accent"
            icon={<Check size={13} strokeWidth={2} />}
            disabled={rows.length === 0}
            loading={assign.isPending}
            onClick={() => apply(rows)}
          >
            Accept all ({rows.length})
          </Button>
        </div>
      }
    >
      <DataTable<ShiftSuggestion>
        layout="design"
        rowKey="employeeId"
        columns={columns}
        data={rows}
        loading={q.isLoading}
        emptyTitle={q.isError ? 'Couldn’t compute suggestions' : 'Nothing to suggest'}
        emptyBody={
          q.isError
            ? (q.error as Error).message
            : 'Everyone with at least 5 imported working days is already on the nearest shift, or there is no imported door data yet.'
        }
        emptyIcon={<Sparkles size={20} strokeWidth={1.5} />}
      />
    </Modal>
  );
}

/** Work shifts: list, add/edit/delete, assigned counts, and "suggest from attendance". Owner/Admin. */
export function ShiftsSection() {
  const toast = useToast();
  const shifts = useShifts();
  const del = useDeleteShift();
  const [editing, setEditing] = useState<ShiftView | 'new' | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const list = shifts.data ?? [];

  const columns: Column<ShiftView>[] = [
    { key: 'name', header: 'Shift', width: 160, render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    {
      key: 'startMinutes',
      header: 'Hours',
      width: 150,
      render: (r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {r.start}–{r.end} <span style={{ color: 'var(--text-faint)' }}>· {r.lengthHours}h</span>
        </span>
      ),
    },
    {
      key: 'graceMinutes',
      header: 'Late after',
      width: 120,
      render: (r) =>
        r.trackPunctuality ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTimeOfDay(r.startMinutes + r.graceMinutes)}</span>
        ) : (
          <Pill tone="gray" size="xs">
            not tracked
          </Pill>
        ),
    },
    { key: 'assignedCount', header: 'People', width: 80, align: 'right', render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.assignedCount}</span> },
    {
      key: 'actions',
      header: '',
      width: 110,
      sortable: false,
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={12} />}
            aria-label={`Delete ${r.name}`}
            disabled={del.isPending}
            onClick={() => {
              const who = r.assignedCount ? ` ${r.assignedCount} employee(s) on it go back to the 09:30 default.` : '';
              if (!window.confirm(`Delete the ${r.name} shift?${who}`)) return;
              del.mutate(r.id, {
                onSuccess: () => toast.success(`Deleted ${r.name}.`),
                onError: (e) => toast.error(`Couldn’t delete. ${(e as Error).message}`),
              });
            }}
          />
        </span>
      ),
    },
  ];

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Shifts</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', maxWidth: 560 }}>
            Lateness and expected hours follow each person’s shift. Without one, late means after 09:30 and a day is 8 hours.
          </p>
        </div>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Button size="sm" variant="subtle" icon={<Sparkles size={12} />} disabled={list.length === 0} onClick={() => setSuggesting(true)}>
            Suggest shifts from attendance
          </Button>
          <Button size="sm" variant="default" icon={<Plus size={12} />} onClick={() => setEditing('new')}>
            Add shift
          </Button>
        </span>
      </div>
      <DataTable<ShiftView>
        layout="design"
        rowKey="id"
        columns={columns}
        data={list}
        loading={shifts.isLoading}
        emptyTitle="No shifts yet"
        emptyBody="Everyone uses the 09:30 default. Add the office’s shifts (e.g. Morning, Day, Evening) and assign people on their profile or from suggestions."
        emptyIcon={<Clock size={20} strokeWidth={1.5} />}
      />
      {editing && <ShiftFormModal shift={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {suggesting && <SuggestionsModal shifts={list} onClose={() => setSuggesting(false)} />}
    </section>
  );
}
