import { useState } from 'react';
import { CalendarDays, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import type { HolidayGroup } from '../../api/people';
import {
  useCreateHoliday,
  useDeleteHolidays,
  useHolidays,
  usePrefillHolidays,
  useUpdateHolidays,
} from '../../hooks/usePeople';
import { dhakaToday, formatDateSpan, formatWeekday } from '../../lib/people';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { Pill } from '../ui/Pill';
import { Select } from '../ui/Select';
import { DataTable, type Column } from '../ui/DataTable';
import { useToast } from '../ui/Toast';
import { FormRow } from './FormBits';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Add a holiday over one or more days, or rename / confirm an existing one (its dates stay). */
function HolidayFormModal({ holiday, year, onClose }: { holiday?: HolidayGroup; year: number; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateHoliday();
  const update = useUpdateHolidays();
  const [name, setName] = useState(holiday?.name ?? '');
  const [from, setFrom] = useState(holiday?.from ?? '');
  const [to, setTo] = useState(holiday?.to ?? '');
  const [tentative, setTentative] = useState(holiday?.tentative ?? false);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  function submit() {
    if (!name.trim()) return setError('Name the holiday.');
    const done = {
      onSuccess: () => {
        toast.success(holiday ? `Saved ${name.trim()}.` : `Added ${name.trim()}.`);
        onClose();
      },
      onError: (err: unknown) => setError((err as Error).message),
    };
    if (holiday) {
      update.mutate({ ids: holiday.ids, name: name.trim(), tentative }, done);
      return;
    }
    if (!from) return setError('Pick the first day.');
    const end = to || from;
    if (end < from) return setError('The last day is before the first day.');
    create.mutate({ name: name.trim(), from, to: end, tentative }, done);
  }

  return (
    <Modal
      onClose={onClose}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      subtitle={
        holiday
          ? `${formatDateSpan(holiday.from, holiday.to)}. To change the dates, delete it and add it again.`
          : 'The office is closed: nobody is absent or late, and the days don’t count toward utilisation.'
      }
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
            {holiday ? 'Save' : 'Add holiday'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Eid-ul-Fitr" />
        </Field>
        {!holiday && (
          <FormRow>
            <Field label="First day" required>
              <Input
                type="date"
                value={from}
                min={`${year - 1}-01-01`}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (!to || to < e.target.value) setTo(e.target.value);
                }}
              />
            </Field>
            <Field label="Last day" hint="Same as the first day for one day.">
              <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </FormRow>
        )}
        <Field label="Date not confirmed yet" hint="For a date that depends on the moon. It still counts as a holiday.">
          <div style={{ paddingTop: 6 }}>
            <Switch checked={tentative} onChange={setTentative} ariaLabel="Date not confirmed yet" />
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/** Office holidays by year: list, add/edit/delete, confirm projected dates, and the Bangladesh preset. Owner/Admin. */
export function HolidaysSection() {
  const toast = useToast();
  const today = dhakaToday();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useHolidays(year);
  const del = useDeleteHolidays();
  const confirm = useUpdateHolidays();
  const prefill = usePrefillHolidays();
  const [editing, setEditing] = useState<HolidayGroup | 'new' | null>(null);
  const list = q.data?.holidays ?? [];
  const missing = q.data?.presetMissing ?? null;
  const next = list.find((h) => h.to >= today && h.workingDaysOff > 0);
  const daysOff = list.reduce((n, h) => n + h.workingDaysOff, 0);

  const columns: Column<HolidayGroup>[] = [
    {
      key: 'name',
      header: 'Holiday',
      width: 240,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', opacity: r.to < today ? 0.6 : 1 }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          {r.tentative && (
            <span title="A projected date: confirm it once the official date is announced">
              <Pill tone="amber" size="xs">
                check date
              </Pill>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'from',
      header: 'Dates',
      width: 200,
      render: (r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: r.to < today ? 0.6 : 1 }}>
          {formatDateSpan(r.from, r.to)}
          <span style={{ color: 'var(--text-faint)' }}>
            {' '}
            · {r.from === r.to ? formatWeekday(r.from) : `${formatWeekday(r.from)}–${formatWeekday(r.to)}`}
          </span>
        </span>
      ),
    },
    {
      key: 'workingDaysOff',
      header: 'Working days off',
      width: 140,
      align: 'right',
      render: (r) =>
        r.workingDaysOff > 0 ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.workingDaysOff}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }} title="Falls on a weekend: changes nothing">
            on a weekend
          </span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      sortable: false,
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {r.tentative && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Check size={12} />}
              aria-label={`Confirm the date of ${r.name}`}
              title="Confirm the date"
              disabled={confirm.isPending}
              onClick={() =>
                confirm.mutate(
                  { ids: r.ids, tentative: false },
                  {
                    onSuccess: () => toast.success(`Confirmed ${r.name}, ${formatDateSpan(r.from, r.to)}.`),
                    onError: (e) => toast.error(`Couldn’t confirm. ${(e as Error).message}`),
                  },
                )
              }
            />
          )}
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={12} />}
            aria-label={`Delete ${r.name}`}
            disabled={del.isPending}
            onClick={() => {
              if (!window.confirm(`Delete ${r.name} (${formatDateSpan(r.from, r.to)})? Those days become working days again.`)) return;
              del.mutate(r.ids, {
                onSuccess: () => toast.success(`Deleted ${r.name}.`),
                onError: (e) => toast.error(`Couldn’t delete. ${(e as Error).message}`),
              });
            }}
          />
        </span>
      ),
    },
  ];

  const years = [thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }));

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Holidays</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', maxWidth: 560 }}>
            On a holiday nobody is absent or late, the day doesn’t count toward utilisation, and leave across it doesn’t use it up.
            {q.data && list.length > 0 && ` ${year}: ${plural(daysOff, 'working day')} off.`}
            {next && ` Next: ${next.name}, ${formatDateSpan(next.from, next.to)}.`}
          </p>
        </div>
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          <Select ariaLabel="Holiday year" options={years} value={String(year)} onChange={(v) => setYear(Number(v))} />
          {missing !== null && missing > 0 && (
            <Button
              size="sm"
              variant="subtle"
              icon={<CalendarDays size={12} />}
              loading={prefill.isPending}
              onClick={() =>
                prefill.mutate(year, {
                  onSuccess: (r) =>
                    toast.success(
                      `Added ${plural(r.added, 'day')} of Bangladesh holidays for ${year}${r.skipped ? `; ${r.skipped} already listed` : ''}. Delete any the office doesn’t observe.`,
                    ),
                  onError: (e) => toast.error(`Couldn’t add them. ${(e as Error).message}`),
                })
              }
            >
              Add Bangladesh holidays for {year}
            </Button>
          )}
          <Button size="sm" variant="default" icon={<Plus size={12} />} onClick={() => setEditing('new')}>
            Add holiday
          </Button>
        </span>
      </div>
      <DataTable<HolidayGroup>
        layout="design"
        rowKey="from"
        columns={columns}
        data={list}
        loading={q.isLoading}
        emptyTitle={q.isError ? 'Couldn’t load holidays' : `No holidays for ${year}`}
        emptyBody={
          q.isError
            ? (q.error as Error).message
            : missing !== null
              ? `Add the Bangladesh government holidays for ${year} and delete any the office doesn’t observe, or add your own.`
              : 'Add the days the office is closed.'
        }
        emptyIcon={<CalendarDays size={20} strokeWidth={1.5} />}
      />
      {editing && (
        <HolidayFormModal holiday={editing === 'new' ? undefined : editing} year={year} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
