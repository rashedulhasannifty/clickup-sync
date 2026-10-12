import { useMemo, useState } from 'react';
import { Check, Paperclip } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import type { AppraisalAction, AppraisalType } from '../../api/appraisals';
import type { EmployeeProfile, EmploymentEventView } from '../../api/people';
import type { PastAppraisalView, PastRecordBody } from '../../api/pastRecords';
import { isDocumentsDisabled } from '../../api/documents';
import { useDocumentMutations, useEmployeeDocuments } from '../../hooks/useDocuments';
import { ACTION_LABEL, ACTIONS, APPRAISAL_TYPE_LABEL, gradeFor } from '../../lib/appraisals';
import { dhakaToday, formatDate } from '../../lib/people';
import { RECORD_KIND, RECORD_KINDS, dialogErrors, type RecordKind } from '../../lib/pastRecords';
import { ChoiceCard, CHOICE_CARD_CSS } from './ChoiceCard';
import { UploadDocumentModal } from './DocumentModals';
import type { PickOption } from './EmployeeFormModal';
import { FormRow, TextArea } from './FormBits';

/** What the dialog is editing: nothing (add), a past event, or a past appraisal. */
export type PastRecordTarget =
  | { kind: 'event'; event: EmploymentEventView }
  | { kind: 'appraisal'; appraisal: PastAppraisalView }
  | null;

const DATE_LABEL: Record<RecordKind, string> = {
  JOINED: 'Joined on',
  JOINED_AS_INTERN: 'Internship started',
  PROBATION_STARTED: 'Probation started',
  CONFIRMED: 'Confirmed on',
  PROMOTED: 'Effective date',
  DESIGNATION_CHANGED: 'Effective date',
  TRANSFERRED: 'Effective date',
  INCREMENT: 'Effective date',
  APPRAISAL: 'Done on',
};

const APPRAISAL_TYPES: AppraisalType[] = ['YEARLY', 'HALF_YEARLY', 'CONFIRMATION', 'INTERNSHIP'];
const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
const PERCENT_NOTE = /^(\d+(?:\.\d+)?)%(?: · ([\s\S]*))?$/;

const digits = (v: string) => v.replace(/[,\s]/g, '');

/** Seeds the form from the record being edited. */
function initial(target: PastRecordTarget) {
  const blank = {
    kind: 'PROMOTED' as RecordKind,
    date: '',
    from: '',
    to: '',
    amount: '',
    notes: '',
    appraisalType: 'YEARLY' as AppraisalType,
    dueDate: '',
    marks: '',
    grade: '',
    actions: [] as AppraisalAction[],
    outcome: '',
    documentId: '',
  };
  if (target?.kind === 'event') {
    const e = target.event;
    const pct = e.type === 'INCREMENT' && e.notes ? PERCENT_NOTE.exec(e.notes) : null;
    return {
      ...blank,
      kind: e.type as RecordKind,
      date: e.effectiveDate,
      from: e.fromValue ?? '',
      to: e.toValue ?? '',
      amount: pct ? pct[1] : '',
      notes: pct ? (pct[2] ?? '') : (e.notes ?? ''),
    };
  }
  if (target?.kind === 'appraisal') {
    const a = target.appraisal;
    return {
      ...blank,
      kind: 'APPRAISAL' as RecordKind,
      date: a.conductedOn,
      appraisalType: a.type,
      dueDate: a.dueDate ?? '',
      marks: a.marks == null ? '' : String(a.marks),
      grade: a.grade ?? '',
      actions: a.actions,
      outcome: a.outcome ?? '',
      notes: a.notes ?? '',
      documentId: a.document?.id ?? '',
    };
  }
  return blank;
}

/**
 * Add (or edit) one past record: history from before this system. The record
 * type is picked from cards; only the fields that type needs are shown, and
 * checked as you go (the server checks the whole history again). A past
 * appraisal can link a document already on file, or upload the scanned form
 * first. Mount only while open.
 */
export function PastRecordModal({
  employee,
  teams,
  target,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  employee: EmployeeProfile;
  teams: PickOption[];
  target: PastRecordTarget;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: PastRecordBody) => void;
}) {
  const [f, setF] = useState(() => initial(target));
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const today = dhakaToday();
  const editing = target !== null;
  const info = RECORD_KIND[f.kind];
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const docs = useEmployeeDocuments(employee.id);
  const docMutations = useDocumentMutations(employee.id);
  const docsAvailable = !docs.isError || !isDocumentsDisabled(docs.error);
  const docOptions = useMemo(
    () => [
      { value: '', label: 'No scan linked' },
      ...(docs.data?.items ?? [])
        .filter((d) => d.category === 'APPRAISAL' || d.id === f.documentId)
        .map((d) => ({ value: d.id, label: `${d.fileName} · ${formatDate(d.createdAt.slice(0, 10))}` })),
    ],
    [docs.data, f.documentId],
  );

  const errors = dialogErrors(f.kind, { date: f.date, from: f.from, to: f.to, amount: f.amount, grade: f.grade, marks: f.marks }, today);
  const shown = touched ? errors : {};
  // The increment, worked out as you type.
  const incrementHint = (() => {
    const a = Number(digits(f.from));
    const b = Number(digits(f.to));
    if (f.kind !== 'INCREMENT' || !(a > 0) || !(b > 0)) return undefined;
    return `${(((b - a) / a) * 100).toFixed(1)}% increase`;
  })();
  const derivedGrade = f.kind === 'APPRAISAL' && !f.grade && f.marks !== '' && Number(f.marks) >= 0 && Number(f.marks) <= 100 ? gradeFor(Number(f.marks)) : null;

  function submit() {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    const body: PastRecordBody = { record: f.kind, date: f.date, notes: f.notes.trim() || undefined };
    if (info.fields.includes('from')) body.from = f.from.trim() ? (f.kind === 'INCREMENT' ? digits(f.from) : f.from.trim()) : undefined;
    if (info.fields.includes('to')) body.to = f.to.trim() ? (f.kind === 'INCREMENT' ? digits(f.to) : f.to.trim()) : undefined;
    if (info.fields.includes('amount')) body.amount = f.amount.trim() ? `${f.amount.trim().replace(/%$/, '')}%` : undefined;
    if (f.kind === 'APPRAISAL') {
      Object.assign(body, {
        appraisalType: f.appraisalType,
        dueDate: f.dueDate || undefined,
        marks: f.marks === '' ? undefined : f.marks,
        grade: f.grade || undefined,
        actions: f.actions.map((a) => ACTION_LABEL[a]).join(', ') || undefined,
        outcome: f.outcome.trim() || undefined,
        documentId: f.documentId || (editing ? null : undefined),
      });
    }
    onSubmit(body);
  }

  const kinds = target?.kind === 'event' ? RECORD_KINDS.filter((k) => k.kind !== 'APPRAISAL') : RECORD_KINDS;

  return (
    <>
      <Modal
        onClose={onClose}
        title={editing ? `Edit past record` : 'Add past record'}
        subtitle={`${employee.fullName} · history from before this system`}
        width={620}
        onSubmit={submit}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            {error && (
              <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12, maxWidth: 380 }}>
                {error}
              </span>
            )}
            <Button type="button" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="accent" loading={pending} icon={<Check size={13} strokeWidth={2} />}>
              {editing ? 'Save' : 'Add record'}
            </Button>
          </div>
        }
      >
        <style>{CHOICE_CARD_CSS}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {target?.kind !== 'appraisal' && (
            <div role="radiogroup" aria-label="Record type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))', gap: 8 }}>
              {kinds.map((k) => (
                <ChoiceCard
                  key={k.kind}
                  name="past-record-kind"
                  checked={f.kind === k.kind}
                  title={k.label}
                  hint={k.hint}
                  onSelect={() => setF((x) => ({ ...x, kind: k.kind, from: '', to: '', amount: '' }))}
                />
              ))}
            </div>
          )}

          <FormRow>
            <Field label={DATE_LABEL[f.kind]} required error={shown.date}>
              <Input type="date" max={today} value={f.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            {f.kind === 'APPRAISAL' && (
              <Field label="Appraisal type">
                <Select
                  fullWidth
                  ariaLabel="Appraisal type"
                  options={APPRAISAL_TYPES.map((t) => ({ value: t, label: APPRAISAL_TYPE_LABEL[t] }))}
                  value={f.appraisalType}
                  onChange={(v) => set('appraisalType', v as AppraisalType)}
                />
              </Field>
            )}
          </FormRow>

          {(f.kind === 'PROMOTED' || f.kind === 'DESIGNATION_CHANGED') && (
            <FormRow>
              <Field label="New designation" required error={shown.to}>
                <Input value={f.to} maxLength={200} placeholder="e.g. Senior Developer" onChange={(e) => set('to', e.target.value)} />
              </Field>
              <Field label="Previous designation" hint="Optional.">
                <Input value={f.from} maxLength={200} onChange={(e) => set('from', e.target.value)} />
              </Field>
            </FormRow>
          )}

          {f.kind === 'TRANSFERRED' && (
            <FormRow>
              <Field label="Moved to team" required error={shown.to}>
                <Select fullWidth searchable ariaLabel="Moved to team" placeholder="Choose a team" options={teams} value={f.to} onChange={(v) => set('to', v)} />
              </Field>
              <Field label="From team" hint="Optional.">
                <Select
                  fullWidth
                  searchable
                  ariaLabel="From team"
                  options={[
                    { value: '', label: 'Not recorded' },
                    ...teams,
                    // A team that no longer exists is kept as its name.
                    ...(f.from && !teams.some((t) => t.value === f.from) ? [{ value: f.from, label: `${f.from} (no longer a team)` }] : []),
                  ]}
                  value={f.from}
                  onChange={(v) => set('from', v)}
                />
              </Field>
            </FormRow>
          )}

          {f.kind === 'INCREMENT' && (
            <FormRow>
              <Field label="Old gross (BDT)" error={shown.from} hint="Whole taka. Optional with a %.">
                <Input inputMode="numeric" value={f.from} onChange={(e) => set('from', e.target.value)} />
              </Field>
              <Field label="New gross (BDT)" required error={shown.to} hint={incrementHint}>
                <Input inputMode="numeric" value={f.to} onChange={(e) => set('to', e.target.value)} />
              </Field>
              <Field label="Increment %" error={shown.amount} hint="Optional.">
                <Input inputMode="decimal" value={f.amount} placeholder="e.g. 12" onChange={(e) => set('amount', e.target.value)} />
              </Field>
            </FormRow>
          )}

          {f.kind === 'APPRAISAL' && (
            <>
              <FormRow>
                <Field label="Marks (0–100)" error={shown.marks}>
                  <Input inputMode="decimal" value={f.marks} onChange={(e) => set('marks', e.target.value)} />
                </Field>
                <Field label="Grade" error={shown.grade} hint={derivedGrade ? `${derivedGrade} from the marks if left empty.` : undefined}>
                  <Select
                    fullWidth
                    ariaLabel="Grade"
                    options={[{ value: '', label: derivedGrade ? `From marks (${derivedGrade})` : 'Not recorded' }, ...GRADES.map((g) => ({ value: g, label: g }))]}
                    value={f.grade}
                    onChange={(v) => set('grade', v)}
                  />
                </Field>
                <Field label="Due date it was for" hint="Optional. Otherwise the date it was done stands for it.">
                  <Input type="date" max={today} value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
                </Field>
              </FormRow>
              <Field label="Recommended">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                  {ACTIONS.map((a) => (
                    <Checkbox
                      key={a}
                      label={ACTION_LABEL[a]}
                      checked={f.actions.includes(a)}
                      onChange={() =>
                        set('actions', f.actions.includes(a) ? f.actions.filter((x) => x !== a) : [...f.actions, a])
                      }
                    />
                  ))}
                </div>
              </Field>
              <Field label="Outcome" hint="The result in a few words. For the record only: nothing is applied.">
                <Input value={f.outcome} maxLength={2000} placeholder="e.g. Confirmed with a 10% increment" onChange={(e) => set('outcome', e.target.value)} />
              </Field>
              {docsAvailable && (
                <Field label="Scanned form">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                      <Select fullWidth ariaLabel="Scanned form" options={docOptions} value={f.documentId} onChange={(v) => set('documentId', v)} />
                    </div>
                    <Button type="button" size="sm" variant="subtle" icon={<Paperclip size={12} />} onClick={() => setUploading(true)} disabled={!docs.data}>
                      Upload scan
                    </Button>
                  </div>
                </Field>
              )}
            </>
          )}

          <Field label="Notes">
            <TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} placeholder="Optional" />
          </Field>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {f.kind === 'APPRAISAL'
              ? 'Counts as already appraised for the due date it stands for. It never runs an outcome or changes the salary.'
              : 'The employee’s status, designation, team and gross salary follow their whole history, oldest first, so a record dated before a newer one does not replace it. Notice and exits go through Start offboarding.'}
          </div>
        </div>
      </Modal>
      {uploading && docs.data && (
        <UploadDocumentModal
          docTypes={docs.data.docTypes}
          defaultCategory="APPRAISAL"
          title="Upload the scanned form"
          subtitle={`${employee.fullName} · filed under Appraisal`}
          submitting={docMutations.upload.isPending}
          onClose={() => setUploading(false)}
          onSubmit={async (input) => {
            const doc = await docMutations.upload.mutateAsync(input);
            set('documentId', doc.id);
            await docs.refetch();
            return doc;
          }}
        />
      )}
    </>
  );
}
