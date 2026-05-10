import { useState } from 'react';
import type { Rate } from '../api/rates';
import { useRates, useCreateRate, useUpdateRate, useDeleteRate } from '../hooks/useRates';
import { Modal } from './ui/Modal';
import { Field } from './ui/Field';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';

interface RateModalProps {
  open: boolean;
  rate: Rate | null;
  onClose: () => void;
}

export function RateModal({ open, rate, onClose }: RateModalProps) {
  const { data: allRates } = useRates();
  const createRate = useCreateRate();
  const updateRate = useUpdateRate();
  const deleteRate = useDeleteRate();

  const [assigneeId, setAssigneeId] = useState(rate?.assigneeId ?? '');
  const [assigneeName, setAssigneeName] = useState(rate?.assigneeName ?? '');
  const [assigneeEmail, setAssigneeEmail] = useState(rate?.assigneeEmail ?? '');
  const [hourlyRateDollars, setHourlyRateDollars] = useState(
    rate ? String(rate.hourlyRateCents / 100) : '',
  );
  const [currency, setCurrency] = useState(rate?.currency ?? 'USD');
  const [validFrom, setValidFrom] = useState(rate?.validFrom ? rate.validFrom.slice(0, 10) : '');
  const [validTo, setValidTo] = useState(rate?.validTo ? rate.validTo.slice(0, 10) : '');

  // Overlap warning: check if validFrom falls inside any existing rate for same assignee (excluding current rate)
  const hasOverlap =
    validFrom.length > 0 &&
    (allRates ?? []).some((r) => {
      if (rate && r.id === rate.id) return false;
      if (r.assigneeId !== assigneeId) return false;
      const from = new Date(r.validFrom);
      const to = r.validTo ? new Date(r.validTo) : null;
      const check = new Date(validFrom);
      return check >= from && (to === null || check < to);
    });

  const isPending = createRate.isPending || updateRate.isPending;

  function handleSave() {
    const parsed = parseFloat(hourlyRateDollars);
    if (isNaN(parsed)) return;
    const hourlyRateCents = Math.round(parsed * 100);
    const payload = {
      assigneeId,
      assigneeName: assigneeName || null,
      assigneeEmail: assigneeEmail || null,
      currency,
      hourlyRateCents,
      validFrom,
      validTo: validTo || null,
    };
    if (rate) {
      updateRate.mutate({ id: rate.id, data: payload }, { onSuccess: () => onClose() });
    } else {
      createRate.mutate(payload, { onSuccess: () => onClose() });
    }
  }

  function handleDelete() {
    if (!rate) return;
    if (!window.confirm('Delete this rate? This cannot be undone.')) return;
    deleteRate.mutate(rate.id, { onSuccess: () => onClose() });
  }

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <div>
        {rate && (
          <Button variant="danger" size="sm" onClick={handleDelete} loading={deleteRate.isPending}>
            Delete
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" onClick={handleSave} loading={isPending}>
          {rate ? 'Save' : 'Create'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rate ? 'Edit Rate' : 'New Rate'}
      width={480}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        <Field label="Assignee ID">
          <Input
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            placeholder="e.g. 12345678"
          />
        </Field>

        <Field label="Assignee Name">
          <Input
            value={assigneeName}
            onChange={(e) => setAssigneeName(e.target.value)}
            placeholder="e.g. Jane Smith"
          />
        </Field>

        <Field label="Assignee Email">
          <Input
            value={assigneeEmail}
            onChange={(e) => setAssigneeEmail(e.target.value)}
            placeholder="e.g. jane@example.com"
            type="email"
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Hourly Rate">
            <Input
              type="number"
              value={hourlyRateDollars}
              onChange={(e) => setHourlyRateDollars(e.target.value)}
              placeholder="e.g. 75"
            />
          </Field>
          <Field label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            >
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Effective From">
            <Input
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </Field>
          <Field label="Effective To">
            <Input
              type="date"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
              placeholder="Open-ended"
            />
          </Field>
        </div>

        <Callout tone="info">
          Rates apply in a closed-open interval: [from, to). Leave &quot;To&quot; empty for an open-ended rate.
        </Callout>

        {hasOverlap && (
          <Callout tone="warning">
            The &quot;Effective From&quot; date falls within an existing rate range for this assignee. Review for overlaps before saving.
          </Callout>
        )}
      </div>
    </Modal>
  );
}
