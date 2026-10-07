import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Eye, FileText, LogOut, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  EXIT_STATUS_LABEL,
  EXIT_TYPE_LABEL,
  INTERVIEW_REASON_LABEL,
  type ExitAnswerValue,
  type ExitInterviewReasonValue,
  type ExitTypeValue,
  type ExitView,
  type InterviewBody,
  type LetterKind,
} from '../api/exits';
import { documentsApi, isDocumentsDisabled } from '../api/documents';
import {
  useAddClearanceItem,
  useAdvanceExit,
  useCancelExit,
  useCompleteExit,
  useEmployeeExit,
  useExitEmployee,
  useGenerateLetter,
  useRemoveClearanceItem,
  useSaveInterview,
  useStartExit,
  useUpdateClearanceItem,
  useUpdateExit,
} from '../hooks/useExits';
import { dhakaToday, formatDate } from '../lib/people';
import { PageHeader } from '../components/ui/PageHeader';
import { QueryError } from '../components/ui/QueryError';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { EmptyState } from '../components/ui/EmptyState';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import { useToast } from '../components/ui/Toast';
import { DocumentViewerModal } from '../components/people/DocumentViewerModal';
import { ExitStatusPill } from '../components/people/ExitStatusPill';
import { EmployeeStatusPill } from '../components/people/PeoplePills';
import { FormRow, HeaderActions, TextArea } from '../components/people/FormBits';

const errText = (e: unknown) => (e as Error).message;

const TYPE_OPTIONS = (Object.keys(EXIT_TYPE_LABEL) as ExitTypeValue[]).map((t) => ({ value: t, label: EXIT_TYPE_LABEL[t] }));
const REASON_OPTIONS = (Object.keys(INTERVIEW_REASON_LABEL) as ExitInterviewReasonValue[]).map((r) => ({
  value: r,
  label: INTERVIEW_REASON_LABEL[r],
}));

const NEXT_LABEL = { NOTICE: 'Exit interview', INTERVIEW: 'Clearance' } as const;

const LABEL_STYLE = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' } as const;

// -- stepper ----------------------------------------------------------------

/** Index of the current step; steps before it are done. 6 = everything done, -1 = cancelled. */
function currentStep(exit: ExitView): number {
  switch (exit.status) {
    case 'NOTICE':
      return 1;
    case 'INTERVIEW':
      return 2;
    case 'CLEARANCE':
      // "Final documents" is the part of clearance after the checklist is ticked off.
      return exit.clearance.total > 0 && exit.clearance.done === exit.clearance.total ? 4 : 3;
    case 'COMPLETED':
      return 6;
    default:
      return -1;
  }
}

function Stepper({ exit }: { exit: ExitView }) {
  const labels = [`${EXIT_TYPE_LABEL[exit.type]} recorded`, 'Notice period', 'Exit interview', 'Clearance', 'Final documents', 'Completed'];
  const cur = currentStep(exit);
  return (
    <ol
      aria-label="Offboarding progress"
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }}
    >
      {labels.map((label, i) => {
        const state = cur === -1 ? 'off' : i < cur ? 'done' : i === cur ? 'current' : 'todo';
        return (
          <li
            key={label}
            aria-current={state === 'current' ? 'step' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: state === 'current' ? 600 : 500,
              border: '1px solid var(--border)',
              background: state === 'current' ? 'var(--accent)' : state === 'done' ? 'var(--pill-green-bg)' : 'var(--surface)',
              color:
                state === 'current' ? '#fff' : state === 'done' ? 'var(--pill-green-text)' : 'var(--text-muted)',
              opacity: state === 'off' ? 0.5 : 1,
            }}
          >
            {state === 'done' ? <Check size={12} strokeWidth={3} /> : state === 'current' ? '●' : null}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

// -- start form -------------------------------------------------------------

function StartForm({ employeeId, fullName, previous }: { employeeId: string; fullName: string; previous?: boolean }) {
  const toast = useToast();
  const start = useStartExit(employeeId);
  const [type, setType] = useState<ExitTypeValue>('RESIGNATION');
  const [noticeDate, setNoticeDate] = useState(dhakaToday());
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');

  function submit() {
    if (!noticeDate || !lastWorkingDay) return setFormError('Set the notice date and the last working day.');
    if (lastWorkingDay < noticeDate) return setFormError('The last working day cannot be before the notice date.');
    setFormError('');
    start.mutate(
      { type, noticeDate, lastWorkingDay, reason: reason.trim() || undefined },
      {
        onSuccess: () => toast.success('Offboarding started. The employee is now on notice.'),
        onError: (e) => setFormError(errText(e)),
      },
    );
  }

  return (
    <Card
      title={previous ? 'Start a new offboarding' : 'Start offboarding'}
      subtitle={`Records ${fullName}'s notice, seeds the clearance checklist and moves them to the notice period.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}
      >
        <FormRow>
          <Field label="Type" required>
            <Select fullWidth options={TYPE_OPTIONS} value={type} onChange={(v) => setType(v as ExitTypeValue)} />
          </Field>
          <Field label="Notice given on" required>
            <Input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
          </Field>
          <Field label="Last working day" required>
            <Input type="date" value={lastWorkingDay} min={noticeDate || undefined} onChange={(e) => setLastWorkingDay(e.target.value)} />
          </Field>
        </FormRow>
        <Field label="Reason">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="Optional" />
        </Field>
        {formError && (
          <span role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>
            {formError}
          </span>
        )}
        <div>
          <Button type="submit" variant="accent" loading={start.isPending} icon={<LogOut size={13} />}>
            Start offboarding
          </Button>
        </div>
      </form>
    </Card>
  );
}

// -- exit interview ---------------------------------------------------------

type Ratings = { role: number; teamLead: number; compensation: number; growth: number; environment: number };
const RATING_ROWS: { key: keyof Ratings; label: string }[] = [
  { key: 'role', label: 'Your role & work' },
  { key: 'teamLead', label: 'Your team lead' },
  { key: 'compensation', label: 'Compensation' },
  { key: 'growth', label: 'Growth opportunities' },
  { key: 'environment', label: 'Work environment' },
];

function Stars({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled: boolean; label: string }) {
  return (
    <span role="radiogroup" aria-label={label} style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} of 5`}
          disabled={disabled}
          // Clicking the current rating clears it: a rating is optional.
          onClick={() => onChange(value === n ? 0 : n)}
          style={{
            border: 0,
            background: 'transparent',
            padding: 1,
            fontSize: 19,
            lineHeight: 1,
            cursor: disabled ? 'default' : 'pointer',
            color: n <= value ? 'var(--amber)' : 'var(--border-strong)',
          }}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function YesMaybeNo({ value, onChange, disabled, label }: { value: ExitAnswerValue | ''; onChange: (v: ExitAnswerValue | '') => void; disabled: boolean; label: string }) {
  const options: { v: ExitAnswerValue; text: string }[] = [
    { v: 'YES', text: 'Yes' },
    { v: 'MAYBE', text: 'Maybe' },
    { v: 'NO', text: 'No' },
  ];
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6 }}>
      {options.map((o) => (
        <Button
          key={o.v}
          type="button"
          size="sm"
          variant={value === o.v ? 'accent' : 'default'}
          disabled={disabled}
          aria-pressed={value === o.v}
          onClick={() => onChange(value === o.v ? '' : o.v)}
        >
          {o.text}
        </Button>
      ))}
    </div>
  );
}

/** Mount with a `key` that changes when a saved interview changes: the state is seeded once. */
function InterviewCard({ exit }: { exit: ExitView }) {
  const toast = useToast();
  const save = useSaveInterview(exit.id);
  const iv = exit.interview;
  const readOnly = !exit.allowed.edit;
  const [reason, setReason] = useState<ExitInterviewReasonValue | ''>(iv?.primaryReason ?? '');
  const [ratings, setRatings] = useState<Ratings>({
    role: iv?.ratings.role ?? 0,
    teamLead: iv?.ratings.teamLead ?? 0,
    compensation: iv?.ratings.compensation ?? 0,
    growth: iv?.ratings.growth ?? 0,
    environment: iv?.ratings.environment ?? 0,
  });
  const [couldHaveDone, setCouldHaveDone] = useState(iv?.couldHaveDone ?? '');
  const [recommend, setRecommend] = useState<ExitAnswerValue | ''>(iv?.wouldRecommend ?? '');
  const [rejoin, setRejoin] = useState<ExitAnswerValue | ''>(iv?.wouldRejoin ?? '');
  const [notes, setNotes] = useState(iv?.notes ?? '');

  function submit() {
    const body: InterviewBody = {
      primaryReason: reason || undefined,
      ratingRole: ratings.role || undefined,
      ratingTeamLead: ratings.teamLead || undefined,
      ratingCompensation: ratings.compensation || undefined,
      ratingGrowth: ratings.growth || undefined,
      ratingEnvironment: ratings.environment || undefined,
      couldHaveDone: couldHaveDone.trim() || undefined,
      wouldRecommend: recommend || undefined,
      wouldRejoin: rejoin || undefined,
      notes: notes.trim() || undefined,
    };
    save.mutate(body, {
      onSuccess: () => toast.success('Exit interview saved.'),
      onError: (e) => toast.error(`Could not save the interview. ${errText(e)}`),
    });
  }

  return (
    <Card
      title="Exit interview"
      subtitle={iv ? `Saved ${formatDate(iv.conductedAt.slice(0, 10))}${iv.conductedByName ? ` by ${iv.conductedByName}` : ''}` : 'Not recorded yet'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Primary reason for leaving">
          <Select
            fullWidth
            disabled={readOnly}
            placeholder="Choose a reason"
            options={REASON_OPTIONS}
            value={reason}
            onChange={(v) => setReason(v as ExitInterviewReasonValue)}
          />
        </Field>
        <div>
          <div style={{ ...LABEL_STYLE, marginBottom: 6 }}>How satisfied were they with… (1–5)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {RATING_ROWS.map((r) => (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span>{r.label}</span>
                <Stars
                  label={r.label}
                  value={ratings[r.key]}
                  disabled={readOnly}
                  onChange={(n) => setRatings((prev) => ({ ...prev, [r.key]: n }))}
                />
              </div>
            ))}
          </div>
        </div>
        <Field label="What could we have done to keep them?">
          <TextArea value={couldHaveDone} onChange={(e) => setCouldHaveDone(e.target.value)} disabled={readOnly} maxLength={4000} />
        </Field>
        <FormRow>
          <Field label="Would recommend us">
            <YesMaybeNo label="Would recommend us" value={recommend} onChange={setRecommend} disabled={readOnly} />
          </Field>
          <Field label="Would rejoin later">
            <YesMaybeNo label="Would rejoin later" value={rejoin} onChange={setRejoin} disabled={readOnly} />
          </Field>
        </FormRow>
        <Field label="Interviewer notes (HR only)">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} maxLength={4000} />
        </Field>
        {!readOnly && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="accent" loading={save.isPending} onClick={submit}>
              Save interview
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// -- clearance --------------------------------------------------------------

function ClearanceCard({ exit }: { exit: ExitView }) {
  const toast = useToast();
  const update = useUpdateClearanceItem(exit.id);
  const add = useAddClearanceItem(exit.id);
  const remove = useRemoveClearanceItem(exit.id);
  const [label, setLabel] = useState('');
  const editable = exit.allowed.edit;

  return (
    <Card title="Clearance checklist" subtitle={`${exit.clearance.done} of ${exit.clearance.total} done`}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {exit.clearance.items.map((item) => (
          <li
            key={item.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}
          >
            {editable ? (
              <Checkbox
                checked={item.done}
                label={`${item.label}: ${item.done ? 'done' : 'open'}`}
                onChange={() =>
                  update.mutate(
                    { itemId: item.id, patch: { done: !item.done } },
                    { onError: (e) => toast.error(`Could not update the item. ${errText(e)}`) },
                  )
                }
              />
            ) : item.done ? (
              <Check size={15} style={{ color: 'var(--green)' }} aria-label="done" />
            ) : (
              <X size={15} style={{ color: 'var(--text-faint)' }} aria-label="open" />
            )}
            <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <span style={{ textDecoration: item.done ? 'line-through' : undefined, color: item.done ? 'var(--text-muted)' : undefined }}>
                {item.label}
              </span>
              {item.done && item.doneAt && (
                <small style={{ display: 'block', color: 'var(--text-faint)' }}>
                  {formatDate(item.doneAt.slice(0, 10))}
                  {item.doneByName ? ` · ${item.doneByName}` : ''}
                </small>
              )}
            </span>
            {editable && (
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={`Remove ${item.label}`}
                icon={<Trash2 size={13} />}
                onClick={() =>
                  remove.mutate(item.id, { onError: (e) => toast.error(`Could not remove the item. ${errText(e)}`) })
                }
              />
            )}
          </li>
        ))}
        {exit.clearance.items.length === 0 && (
          <li style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No items. Add what has to be returned or closed.</li>
        )}
      </ul>
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = label.trim();
            if (!text) return;
            add.mutate(text, {
              onSuccess: () => setLabel(''),
              onError: (err) => toast.error(`Could not add the item. ${errText(err)}`),
            });
          }}
          style={{ display: 'flex', gap: 8, marginTop: 12 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="Add an item, e.g. Return access card" aria-label="New clearance item" />
          </div>
          <Button type="submit" variant="default" loading={add.isPending} icon={<Plus size={13} />}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

// -- final documents --------------------------------------------------------

const LETTERS: { kind: LetterKind; docType: string; label: string }[] = [
  { kind: 'experience', docType: 'EXPERIENCE_LETTER', label: 'Experience letter' },
  { kind: 'release', docType: 'RELEASE_LETTER', label: 'Release letter' },
];

function DocumentsCard({ exit }: { exit: ExitView }) {
  const toast = useToast();
  const generate = useGenerateLetter(exit.id);
  const [viewing, setViewing] = useState<{ id: string; fileName: string; contentType: string } | null>(null);
  const [busy, setBusy] = useState<LetterKind | null>(null);
  const resignation = exit.documents.find((d) => d.docType === 'RESIGNATION_LETTER');

  function run(kind: LetterKind, label: string, replacing: boolean) {
    setBusy(kind);
    generate.mutate(kind, {
      onSuccess: () => toast.success(`${label} ${replacing ? 'regenerated as a new version' : 'generated'}.`),
      onError: (e) =>
        toast.error(
          isDocumentsDisabled(e)
            ? 'Document storage is not configured on this server, so letters cannot be saved.'
            : `Could not generate the ${label.toLowerCase()}. ${errText(e)}`,
        ),
      onSettled: () => setBusy(null),
    });
  }

  const row = (key: string, content: ReactNode, action: ReactNode) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <FileText size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <span style={{ flex: '1 1 180px', minWidth: 0, fontSize: 13 }}>{content}</span>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{action}</span>
    </div>
  );

  return (
    <Card title="Final documents" subtitle="Letters are generated as PDFs and kept in the employee's documents.">
      {row(
        'resignation',
        resignation ? (
          <>
            {resignation.fileName} <small style={{ color: 'var(--text-faint)' }}>· uploaded</small>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>Resignation letter · upload it from the employee's Documents tab</span>
        ),
        resignation && (
          <Button size="sm" variant="ghost" icon={<Eye size={13} />} onClick={() => setViewing(resignation)}>
            View
          </Button>
        ),
      )}
      {LETTERS.map((l) => {
        const doc = exit.documents.find((d) => d.docType === l.docType);
        return row(
          l.kind,
          doc ? (
            <>
              {doc.fileName} <small style={{ color: 'var(--text-faint)' }}>· v{doc.version} · {formatDate(doc.createdAt.slice(0, 10))}</small>
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{l.label} · not generated</span>
          ),
          <>
            {doc && (
              <>
                <Button size="sm" variant="ghost" icon={<Eye size={13} />} onClick={() => setViewing(doc)}>
                  Preview
                </Button>
                <a
                  href={documentsApi.contentUrl(doc.id, true)}
                  download={doc.fileName}
                  aria-label={`Download ${doc.fileName}`}
                  style={{ display: 'inline-flex', alignItems: 'center', padding: 6, color: 'var(--text-muted)' }}
                >
                  <Download size={14} />
                </a>
              </>
            )}
            {exit.allowed.letters && (
              <Button
                size="sm"
                variant="default"
                loading={busy === l.kind}
                icon={doc ? <RefreshCw size={13} /> : undefined}
                onClick={() => run(l.kind, l.label, !!doc)}
              >
                {doc ? 'Regenerate' : 'Generate'}
              </Button>
            )}
          </>,
        );
      })}
      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

// -- details, complete, cancel ---------------------------------------------

function DetailsCard({ exit }: { exit: ExitView }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card
      title="Details"
      action={
        exit.allowed.edit ? (
          <Button size="sm" variant="subtle" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : undefined
      }
    >
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0, fontSize: 13 }}>
        <dt style={{ color: 'var(--text-muted)' }}>Type</dt>
        <dd style={{ margin: 0 }}>{EXIT_TYPE_LABEL[exit.type]}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>Notice given</dt>
        <dd style={{ margin: 0 }}>{formatDate(exit.noticeDate)}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>Last working day</dt>
        <dd style={{ margin: 0 }}>{formatDate(exit.lastWorkingDay)}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>Reason</dt>
        <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{exit.reason ?? '—'}</dd>
        {exit.overrideNote && (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>Completed with open items</dt>
            <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{exit.overrideNote}</dd>
          </>
        )}
        {exit.status === 'COMPLETED' && (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>Login</dt>
            <dd style={{ margin: 0 }}>
              {exit.loginDisabled ? 'Disabled and signed out' : exit.employee.hasLogin ? 'Left active' : 'None linked'}
            </dd>
          </>
        )}
        {exit.status === 'CANCELLED' && (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>Cancelled</dt>
            <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{exit.cancelNote}</dd>
          </>
        )}
      </dl>
      {editing && <EditDetailsModal exit={exit} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function EditDetailsModal({ exit, onClose }: { exit: ExitView; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateExit(exit.id);
  const [type, setType] = useState<ExitTypeValue>(exit.type);
  const [noticeDate, setNoticeDate] = useState(exit.noticeDate);
  const [lastWorkingDay, setLastWorkingDay] = useState(exit.lastWorkingDay);
  const [reason, setReason] = useState(exit.reason ?? '');
  const [formError, setFormError] = useState('');

  function submit() {
    if (!noticeDate || !lastWorkingDay) return setFormError('Set both dates.');
    if (lastWorkingDay < noticeDate) return setFormError('The last working day cannot be before the notice date.');
    setFormError('');
    update.mutate(
      { type, noticeDate, lastWorkingDay, reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success('Offboarding details updated.');
          onClose();
        },
        onError: (e) => setFormError(errText(e)),
      },
    );
  }

  return (
    <Modal
      onClose={onClose}
      title="Edit offboarding"
      subtitle={exit.employee.fullName}
      width={520}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {formError && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {formError}
            </span>
          )}
          <Button type="button" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" loading={update.isPending}>
            Save
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Type">
          <Select fullWidth options={TYPE_OPTIONS} value={type} onChange={(v) => setType(v as ExitTypeValue)} />
        </Field>
        <FormRow>
          <Field label="Notice given on">
            <Input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
          </Field>
          <Field label="Last working day">
            <Input type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} />
          </Field>
        </FormRow>
        <Field label="Reason">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

function CompleteModal({ exit, onClose }: { exit: ExitView; onClose: () => void }) {
  const toast = useToast();
  const complete = useCompleteExit(exit.id);
  const open = exit.clearance.total - exit.clearance.done;
  const [disableLogin, setDisableLogin] = useState(true);
  const [overrideNote, setOverrideNote] = useState('');
  const [formError, setFormError] = useState('');
  const needsNote = open > 0;

  function submit() {
    if (needsNote && !overrideNote.trim()) return setFormError('Explain why the exit is completed with open items.');
    setFormError('');
    complete.mutate(
      {
        disableLogin: exit.employee.hasLogin ? disableLogin : undefined,
        overrideNote: needsNote ? overrideNote.trim() : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`${exit.employee.fullName} is now a former employee.`);
          onClose();
        },
        onError: (e) => setFormError(errText(e)),
      },
    );
  }

  return (
    <Modal
      onClose={onClose}
      title="Complete exit"
      subtitle={`${exit.employee.fullName} · last working day ${formatDate(exit.lastWorkingDay)}`}
      width={520}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {formError && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {formError}
            </span>
          )}
          <Button type="button" variant="default" onClick={onClose}>
            Not yet
          </Button>
          <Button type="submit" variant="danger" loading={complete.isPending} disabled={needsNote && !overrideNote.trim()}>
            Complete exit
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          The profile becomes a read-only former employee with an exit date of {formatDate(exit.lastWorkingDay)}. History, KPIs and
          documents are kept. They drop out of attendance and the missing-documents counts.
        </p>
        {exit.lastWorkingDay > dhakaToday() && (
          <p style={{ margin: 0, color: 'var(--amber)' }}>
            The last working day is still ahead. Completing now marks them as exited from today.
          </p>
        )}
        {needsNote && (
          <Field
            label={`${open} clearance item${open === 1 ? ' is' : 's are'} still open`}
            required
            hint="Completing anyway needs a note. It is kept on the exit."
          >
            <TextArea value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} maxLength={2000} placeholder="e.g. Laptop is in transit" />
          </Field>
        )}
        {exit.employee.hasLogin ? (
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>
              <strong style={{ fontWeight: 600 }}>Disable their login</strong>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>Blocks sign-in and signs them out everywhere.</small>
            </span>
            <Switch checked={disableLogin} onChange={setDisableLogin} ariaLabel="Disable the linked login" />
          </label>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>No login is linked to this employee, so there is no account to disable.</p>
        )}
      </div>
    </Modal>
  );
}

function CancelModal({ exit, onClose }: { exit: ExitView; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelExit(exit.id);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  function submit() {
    if (!note.trim()) return setFormError('Say why the offboarding is cancelled.');
    setFormError('');
    cancel.mutate(note.trim(), {
      onSuccess: () => {
        toast.success('Offboarding cancelled. The employee is back to their previous status.');
        onClose();
      },
      onError: (e) => setFormError(errText(e)),
    });
  }

  return (
    <Modal
      onClose={onClose}
      title="Cancel offboarding"
      subtitle={exit.employee.fullName}
      width={480}
      onSubmit={submit}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {formError && (
            <span role="alert" style={{ marginRight: 'auto', color: 'var(--red)', fontSize: 12 }}>
              {formError}
            </span>
          )}
          <Button type="button" variant="default" onClick={onClose}>
            Keep offboarding
          </Button>
          <Button type="submit" variant="danger" loading={cancel.isPending}>
            Cancel offboarding
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          The employee goes back to the status they had before, and a note is added to their timeline. Documents already generated are kept.
        </p>
        <Field label="Why was it cancelled?" required>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

// -- page -------------------------------------------------------------------

/** `/people/:id/exit`: start offboarding, or work through the stepper to completion. */
export function ExitPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const exitQuery = useEmployeeExit(id);
  const employeeQuery = useExitEmployee(id);
  const exit = exitQuery.data?.exit ?? null;
  const advance = useAdvanceExit(exit?.id ?? '');
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const backLink = (
    <Link to={id ? `/people/${id}` : '/people'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <ArrowLeft size={13} /> Back to {employeeQuery.data?.fullName ?? 'employee'}
    </Link>
  );

  if (exitQuery.isLoading || employeeQuery.isLoading) return <PageSkeleton />;
  if (exitQuery.isError || employeeQuery.isError || !employeeQuery.data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHeader title="Offboarding" breadcrumb={backLink} />
        <QueryError query={exitQuery.isError ? exitQuery : employeeQuery} what="offboarding" />
        <EmptyState title="Could not load this offboarding" body="Check the link, or go back to the employee." />
      </div>
    );
  }

  const employee = employeeQuery.data;
  const startable = employee.status !== 'EXITED';
  // A cancelled exit leaves nothing active, so the form for a new one sits under it.
  const showStart = startable && exit?.status === 'CANCELLED';

  if (!exit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PageHeader
          title={`Offboarding · ${employee.fullName}`}
          description={`${employee.designation} · ${employee.teamName ?? 'No team'}`}
          breadcrumb={backLink}
          badge={<EmployeeStatusPill status={employee.status} />}
        />
        {startable ? (
          <StartForm employeeId={employee.id} fullName={employee.fullName} />
        ) : (
          <EmptyState
            title="Former employee"
            body={`${employee.fullName} exited on ${formatDate(employee.exitDate)}. There is no offboarding record for them, because the exit was recorded on the timeline.`}
          />
        )}
      </div>
    );
  }

  const next = exit.allowed.advance ? NEXT_LABEL[exit.status as keyof typeof NEXT_LABEL] : null;
  const interviewKey = `${exit.id}:${exit.interview?.conductedAt ?? 'none'}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title={`Offboarding · ${exit.employee.fullName}`}
        description={`${exit.employee.designation}${exit.employee.teamName ? ` · ${exit.employee.teamName}` : ''} · ${EXIT_TYPE_LABEL[exit.type].toLowerCase()} · last working day ${formatDate(exit.lastWorkingDay)}`}
        breadcrumb={backLink}
        badge={<ExitStatusPill status={exit.status} size="sm" />}
        actions={
          <HeaderActions>
            {exit.allowed.cancel && (
              <Button size="md" variant="ghost" onClick={() => setCancelling(true)}>
                Cancel offboarding
              </Button>
            )}
            {next && (
              <Button
                size="md"
                variant="accent"
                loading={advance.isPending}
                onClick={() =>
                  advance.mutate(undefined, {
                    onSuccess: () => toast.success(`Moved to ${next.toLowerCase()}.`),
                    onError: (e) => toast.error(`Could not advance. ${errText(e)}`),
                  })
                }
              >
                Move to {next.toLowerCase()}
              </Button>
            )}
            {exit.allowed.complete && (
              <Button size="md" variant="danger" icon={<LogOut size={13} />} onClick={() => setCompleting(true)}>
                Complete exit
              </Button>
            )}
          </HeaderActions>
        }
      />

      <Stepper exit={exit} />

      {exit.status === 'CANCELLED' && (
        <div role="status" style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--muted-bg)', fontSize: 13 }}>
          This offboarding was cancelled{exit.cancelledAt ? ` on ${formatDate(exit.cancelledAt.slice(0, 10))}` : ''}. {EXIT_STATUS_LABEL.CANCELLED} records are kept for history.
        </div>
      )}
      {exit.status === 'COMPLETED' && (
        <div role="status" style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--muted-bg)', fontSize: 13 }}>
          Completed{exit.completedAt ? ` on ${formatDate(exit.completedAt.slice(0, 10))}` : ''}. The profile is a read-only former employee; history, KPIs and documents are kept.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'start' }}>
        <InterviewCard key={interviewKey} exit={exit} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DetailsCard exit={exit} />
          <ClearanceCard exit={exit} />
          <DocumentsCard exit={exit} />
        </div>
      </div>

      {showStart && <StartForm employeeId={employee.id} fullName={employee.fullName} previous />}

      {completing && <CompleteModal exit={exit} onClose={() => setCompleting(false)} />}
      {cancelling && <CancelModal exit={exit} onClose={() => setCancelling(false)} />}
    </div>
  );
}
