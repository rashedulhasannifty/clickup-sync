import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import type { AddEventBody, EmployeeProfile, ManualEventType } from '../../api/people';
import { EVENT_EFFECT, EVENT_LABEL, MANUAL_EVENT_TYPES, dhakaToday, eventAllowed, formatDate } from '../../lib/people';
import type { PickOption } from './EmployeeFormModal';
import { FormRow, TextArea } from './FormBits';

const NEEDS_DESIGNATION: ManualEventType[] = ['PROMOTED', 'DESIGNATION_CHANGED'];

/** The day after `ymd`. */
const nextDay = (ymd: string) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + 1)).toISOString().slice(0, 10);

/**
 * Add an employment event. Mount only while open (state is seeded once).
 * A promotion or designation change asks for the new designation, and a
 * transfer for the destination team: those become the employee's new value.
 * Only the events that fit the employee's stage are offered (the server checks
 * the same): an intern can be moved to probation or have the internship
 * extended, and is never confirmed directly.
 */
export function AddEventModal({
  employee,
  teams,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  employee: EmployeeProfile;
  teams: PickOption[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: AddEventBody) => void;
}) {
  const choices = MANUAL_EVENT_TYPES.filter((t) => eventAllowed(t, employee.status));
  const intern = employee.status === 'INTERN';
  const currentEnd = employee.internshipEndDate;
  const [type, setType] = useState<ManualEventType>(intern ? 'PROBATION_STARTED' : 'PROMOTED');
  const [effectiveDate, setEffectiveDate] = useState(intern && currentEnd ? nextDay(currentEnd) : dhakaToday());
  const [newEnd, setNewEnd] = useState('');
  const [designation, setDesignation] = useState('');
  const [teamId, setTeamId] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const needsDesignation = NEEDS_DESIGNATION.includes(type);
  const needsTeam = type === 'TRANSFERRED';
  const needsEnd = type === 'INTERNSHIP_EXTENDED';
  // Moving someone to the team they are already on is a no-op the API would accept, so don't offer it.
  const teamChoices = teams.filter((t) => t.value !== employee.teamId);

  function submit() {
    if (!effectiveDate) return setFormError('Set the effective date.');
    if (needsDesignation && !designation.trim()) return setFormError('Enter the new designation.');
    if (needsTeam && !teamId) return setFormError('Choose the team the employee moves to.');
    if (needsEnd && !newEnd) return setFormError('Choose the new internship end date.');
    if (needsEnd && currentEnd && newEnd <= currentEnd) return setFormError(`The new end must be after ${formatDate(currentEnd)}.`);
    if (type === 'PROBATION_STARTED' && effectiveDate < employee.joinDate) return setFormError('Probation cannot start before the join date.');
    setFormError('');
    onSubmit({
      type,
      effectiveDate,
      toValue: needsDesignation ? designation.trim() : needsTeam ? teamId : needsEnd ? newEnd : undefined,
      notes: notes.trim() || undefined,
    });
  }

  const message = formError || error;

  return (
    <Modal
      onClose={onClose}
      title="Add event"
      subtitle={`${employee.fullName} · currently ${employee.designation}`}
      width={500}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {message && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {message}
            </span>
          )}
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={pending} icon={<Check size={13} strokeWidth={2} />}>
            Add event
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormRow>
          <Field label="Event" required hint={EVENT_EFFECT[type]}>
            <Select
              fullWidth
              options={choices.map((t) => ({ value: t, label: EVENT_LABEL[t] }))}
              value={type}
              onChange={(x) => {
                const next = x as ManualEventType;
                setType(next);
                // Moving to probation defaults to the day after the internship ends.
                if (next === 'PROBATION_STARTED' && currentEnd) setEffectiveDate(nextDay(currentEnd));
                else if (type === 'PROBATION_STARTED') setEffectiveDate(dhakaToday());
                setFormError('');
              }}
            />
          </Field>
          <Field label={type === 'PROBATION_STARTED' ? 'Probation starts' : 'Effective date'} required>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
        </FormRow>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6 }}>
          To give notice or record an exit, use Start offboarding on the employee page.
        </div>

        {needsDesignation && (
          <Field label="New designation" required hint={`Currently ${employee.designation}.`}>
            <Input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              maxLength={200}
              placeholder="e.g. Senior Developer"
            />
          </Field>
        )}
        {needsEnd && (
          <Field label="New internship end" required hint={currentEnd ? `Currently ends ${formatDate(currentEnd)}. A new internship review falls due on the new date.` : undefined}>
            <Input type="date" min={currentEnd ? nextDay(currentEnd) : undefined} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
          </Field>
        )}
        {needsTeam && (
          <Field label="Moves to team" required hint={employee.teamName ? `Currently ${employee.teamName}.` : 'Currently no team.'}>
            <Select fullWidth searchable placeholder="Choose a team" options={teamChoices} value={teamId} onChange={setTeamId} />
          </Field>
        )}

        <Field label="Notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}
