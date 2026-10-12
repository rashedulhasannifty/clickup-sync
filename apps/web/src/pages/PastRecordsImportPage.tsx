import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, UploadCloud, Users } from 'lucide-react';
import type { PastRecordRow, PastRecordsApplyResult, PastRecordsEmployeeSummary, PastRecordsPreview, RowError, SummarySide } from '../api/pastRecords';
import { useEmployees } from '../hooks/usePeople';
import { usePastRecordsImport } from '../hooks/usePastRecords';
import { APPRAISAL_TYPE_PHRASE, takaText } from '../lib/appraisals';
import { formatDate } from '../lib/people';
import { MAX_IMPORT_ROWS, STATUS_WORD } from '../lib/pastRecords';
import { downloadTemplate, readRecordsFile } from '../lib/pastRecordsXlsx';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Pill } from '../components/ui/Pill';
import { useToast } from '../components/ui/Toast';

const FIELD_LABEL: Record<string, string> = {
  employee: 'Employee',
  record: 'Record',
  date: 'Date',
  from: 'From',
  to: 'To',
  amount: 'Amount',
  grade: 'Grade',
  marks: 'Marks',
  appraisalType: 'Appraisal type',
  actions: 'Actions',
  dueDate: 'Due date',
  outcome: 'Outcome',
  notes: 'Notes',
};

/** How many employee cards and error rows render before "Show more" (big files stay quick). */
const PAGE = 30;

function Step({ n, title, children, done }: { n: number; title: string; children: ReactNode; done?: boolean }) {
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span
          aria-hidden
          style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600,
            background: done ? 'var(--pill-green-bg)' : 'var(--accent-soft)',
            color: done ? 'var(--pill-green-text)' : 'var(--accent-strong)',
          }}
        >
          {done ? <CheckCircle2 size={14} /> : n}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{title}</div>
          {children}
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber)' : tone === 'red' ? 'var(--red)' : 'var(--text)';
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 22, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{value.toLocaleString('en-US')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

/** Errors grouped by sheet row, in plain words. */
function ErrorList({ errors }: { errors: RowError[] }) {
  const [shown, setShown] = useState(PAGE);
  const byRow = useMemo(() => {
    const m = new Map<number, RowError[]>();
    for (const e of errors) m.set(e.row, [...(m.get(e.row) ?? []), e]);
    return [...m.entries()];
  }, [errors]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {byRow.slice(0, shown).map(([row, list]) => (
        <div key={row} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
          <span style={{ flexShrink: 0, width: 64, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>Row {row}</span>
          <span style={{ minWidth: 0, color: 'var(--text)' }}>
            {list.map((e, i) => (
              <span key={i} style={{ display: 'block' }}>
                <span style={{ color: 'var(--text-muted)' }}>{FIELD_LABEL[e.field] ?? e.field}: </span>
                {e.message}
              </span>
            ))}
          </span>
        </div>
      ))}
      {byRow.length > shown && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE * 4)}>
            Show more ({byRow.length - shown} more rows)
          </Button>
        </div>
      )}
    </div>
  );
}

function nextText(n: SummarySide['nextAppraisal']): string {
  if (!n) return 'None';
  return `${APPRAISAL_TYPE_PHRASE[n.type]} ${n.overdue ? 'overdue since' : 'due'} ${formatDate(n.dueDate)}`;
}

/** One line of the before -> after table; the changed ones are highlighted. */
function DiffRow({ label, before, after, warn }: { label: string; before: string; after: string; warn?: boolean }) {
  const changed = before !== after;
  return (
    <tr>
      <td style={{ padding: '4px 10px 4px 0', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
      <td style={{ padding: '4px 8px', fontSize: 13, color: changed ? 'var(--text-muted)' : 'var(--text)', textDecoration: changed ? 'line-through' : undefined, verticalAlign: 'top' }}>
        {before}
      </td>
      <td style={{ padding: '4px 6px', color: 'var(--text-faint)', verticalAlign: 'top' }}>{changed ? <ArrowRight size={12} /> : null}</td>
      <td style={{ padding: '4px 0', fontSize: 13, fontWeight: changed ? 600 : 400, color: changed ? (warn ? 'var(--amber)' : 'var(--accent-strong)') : 'var(--text-faint)', verticalAlign: 'top' }}>
        {changed ? after : 'no change'}
      </td>
    </tr>
  );
}

function EmployeeCard({ s, open, onToggle }: { s: PastRecordsEmployeeSummary; open: boolean; onToggle: () => void }) {
  const adds = s.eventsToAdd + s.appraisalsToAdd;
  const { before: b, after: a } = s;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 200px' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.fullName}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.email}
            {s.changed.length > 0 && ` · changes ${s.changed.length === 1 ? 'one field' : `${s.changed.length} fields`}`}
          </span>
        </span>
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {adds > 0 && <Pill tone="purple" size="xs">+{adds} {adds === 1 ? 'record' : 'records'}</Pill>}
          {s.alreadyRecorded > 0 && <Pill tone="gray" size="xs">{s.alreadyRecorded} already recorded</Pill>}
          {s.overdueCleared.length > 0 && <Pill tone="green" size="xs">{s.overdueCleared.length} overdue cleared</Pill>}
          {s.warnings.length > 0 && <Pill tone="amber" size="xs">Check</Pill>}
          {s.rowsWithErrors > 0 && <Pill tone="red" size="xs">{s.rowsWithErrors} with errors</Pill>}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px 36px' }}>
          {s.warnings.map((w) => (
            <div key={w} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
            </div>
          ))}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                <DiffRow label="Status" before={STATUS_WORD[b.status] ?? b.status} after={STATUS_WORD[a.status] ?? a.status} warn={s.warnings.length > 0} />
                <DiffRow label="Designation" before={b.designation} after={a.designation} />
                <DiffRow label="Team" before={b.teamName ?? '—'} after={a.teamName ?? '—'} />
                <DiffRow label="Gross salary" before={takaText(b.grossSalary)} after={takaText(a.grossSalary)} />
                <DiffRow label="Joined" before={formatDate(b.joinDate)} after={formatDate(a.joinDate)} />
                <DiffRow label="Probation start" before={formatDate(b.probationStartDate)} after={formatDate(a.probationStartDate)} />
                <DiffRow label="Confirmed" before={formatDate(b.confirmationDate)} after={formatDate(a.confirmationDate)} />
                <DiffRow label="Next appraisal" before={nextText(b.nextAppraisal)} after={nextText(a.nextAppraisal)} />
              </tbody>
            </table>
          </div>
          {s.overdueCleared.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 6 }}>
              No longer overdue: {s.overdueCleared.map((o) => `${APPRAISAL_TYPE_PHRASE[o.type]} due ${formatDate(o.dueDate)}`).join(', ')}
            </div>
          )}
          {a.overdue.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 4 }}>
              Still overdue after this: {a.overdue.map((o) => `${APPRAISAL_TYPE_PHRASE[o.type]} due ${formatDate(o.dueDate)}`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * People -> Import past records. HR downloads the template (optionally with a
 * row per current employee), fills in everyone's history from before this
 * system, uploads it, checks the preview (errors by row, and each employee's
 * before -> after), and applies it in one go. The file is read in the browser;
 * the server checks everything again, and applying the same file twice adds
 * nothing.
 */
export function PastRecordsImportPage() {
  const toast = useToast();
  const directory = useEmployees({});
  const { preview, apply } = usePastRecordsImport();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [rows, setRows] = useState<PastRecordRow[] | null>(null);
  const [skippedExamples, setSkippedExamples] = useState(0);
  const [result, setResult] = useState<PastRecordsApplyResult | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shownCards, setShownCards] = useState(PAGE);
  const [downloading, setDownloading] = useState<'blank' | 'employees' | null>(null);

  const data: PastRecordsPreview | undefined = preview.data;
  const errorRows = data ? new Set(data.errors.map((e) => e.row)).size : 0;
  const canApply = !!data && !!rows && data.errors.length === 0 && data.recordsToAdd > 0 && !apply.isPending;
  // Employees the file touches first, the ones that only repeat what is recorded after.
  const cards = useMemo(
    () =>
      [...(data?.employees ?? [])].sort(
        (x, y) =>
          Number(y.rowsWithErrors > 0) - Number(x.rowsWithErrors > 0) ||
          y.eventsToAdd + y.appraisalsToAdd - (x.eventsToAdd + x.appraisalsToAdd) ||
          x.fullName.localeCompare(y.fullName),
      ),
    [data],
  );

  async function pick(f: File | null) {
    if (!f) return;
    setFile(f);
    setResult(null);
    setRows(null);
    setProblems([]);
    setOpen(new Set());
    setShownCards(PAGE);
    preview.reset();
    apply.reset();
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      setProblems(['Upload the filled template as .xlsx, or a .csv with the same columns.']);
      return;
    }
    setReading(true);
    try {
      const read = await readRecordsFile(f);
      setSkippedExamples(read.skippedExamples);
      if (read.problems.length > 0) return setProblems(read.problems);
      if (read.rows.length > MAX_IMPORT_ROWS)
        return setProblems([`The file has ${read.rows.length.toLocaleString('en-US')} records; one import takes up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')}. Split it into smaller files.`]);
      setRows(read.rows);
      preview.mutate(read.rows);
    } catch (e) {
      setProblems([`The file could not be read. ${(e as Error).message}`]);
    } finally {
      setReading(false);
    }
  }

  async function template(withEmployees: boolean) {
    setDownloading(withEmployees ? 'employees' : 'blank');
    try {
      await downloadTemplate(
        withEmployees
          ? (directory.data ?? [])
              .filter((e) => e.status !== 'EXITED')
              .map((e) => ({ email: e.email, employeeCode: e.employeeCode, fullName: e.fullName, joinDate: e.joinDate, status: e.status }))
          : null,
      );
    } catch (e) {
      toast.error(`Couldn’t build the template. ${(e as Error).message}`);
    } finally {
      setDownloading(null);
    }
  }

  const backLink = (
    <Link to="/people" style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <ArrowLeft size={13} /> Employees
    </Link>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1000 }}>
      <PageHeader
        breadcrumb={backLink}
        title="Import past records"
        description="Bring in everyone’s history from before this system: joining as an intern, probation, confirmation, promotions, increments, transfers and paper appraisals. Nothing is saved until you apply, and nothing is sent to anyone."
      />

      <Step n={1} title="Download the template">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
          One row per event. The workbook has dropdowns for the record type and a “How to fill” sheet that explains each one. The version with your employees
          starts with a Joined row for each of them, so you only add the history.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="subtle" icon={<Download size={13} />} loading={downloading === 'blank'} onClick={() => template(false)}>
            Download template
          </Button>
          <Button
            variant="subtle"
            icon={<Users size={13} />}
            loading={downloading === 'employees'}
            disabled={!directory.data}
            onClick={() => template(true)}
          >
            Download with our employees
          </Button>
        </div>
      </Step>

      <Step n={2} title="Upload the filled file" done={!!rows && problems.length === 0}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void pick(e.dataTransfer.files[0] ?? null);
          }}
          style={{
            border: `2px dashed ${over ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 10,
            padding: 20,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          {file ? <FileSpreadsheet size={20} style={{ marginBottom: 6 }} /> : <UploadCloud size={20} style={{ marginBottom: 6 }} />}
          <div>
            {file ? <strong style={{ color: 'var(--text)' }}>{file.name}</strong> : 'Drop the .xlsx or .csv here or '}
            <button type="button" onClick={() => input.current?.click()} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', marginLeft: file ? 6 : 0 }}>
              {file ? 'choose another' : 'browse'}
            </button>
          </div>
          {rows && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'record' : 'records'} read
              {skippedExamples > 0 ? ` · ${skippedExamples} example ${skippedExamples === 1 ? 'row' : 'rows'} skipped` : ''}
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            hidden
            onChange={(e) => {
              void pick(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>
        {(reading || preview.isPending) && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{reading ? 'Reading the file…' : 'Checking every record…'}</div>}
        {problems.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <Callout tone="red">{problems.map((p) => <div key={p}>{p}</div>)}</Callout>
          </div>
        )}
        {preview.isError && (
          <div style={{ marginTop: 10 }}>
            <Callout tone="red">The check failed. {(preview.error as Error).message}</Callout>
          </div>
        )}
      </Step>

      {data && !result && (
        <Step n={3} title="Check what will change" done={data.errors.length === 0}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="records to add" value={data.recordsToAdd} tone={data.recordsToAdd > 0 ? 'green' : undefined} />
            <Stat label="already recorded" value={data.alreadyRecorded} />
            <Stat label="employees" value={data.employees.length} />
            <Stat label={errorRows === 1 ? 'row with errors' : 'rows with errors'} value={errorRows} tone={errorRows > 0 ? 'red' : undefined} />
          </div>

          {data.errors.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', marginBottom: 6 }}>Fix these rows in the file, then upload it again</div>
              <ErrorList errors={data.errors} />
            </div>
          )}

          {data.alreadyRecorded > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {data.alreadyRecorded.toLocaleString('en-US')} {data.alreadyRecorded === 1 ? 'row matches' : 'rows match'} something already recorded and will be skipped.
            </div>
          )}

          {cards.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Each employee, before → after</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(new Set(cards.slice(0, shownCards).map((c) => c.employeeId)))}>
                    Expand all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>
                    Collapse all
                  </Button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cards.slice(0, shownCards).map((s) => (
                  <EmployeeCard
                    key={s.employeeId}
                    s={s}
                    open={open.has(s.employeeId)}
                    onToggle={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.employeeId)) next.delete(s.employeeId);
                        else next.add(s.employeeId);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
              {cards.length > shownCards && (
                <div style={{ marginTop: 8 }}>
                  <Button size="sm" variant="ghost" onClick={() => setShownCards((n) => n + PAGE)}>
                    Show more employees ({cards.length - shownCards} more)
                  </Button>
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Button
              variant="accent"
              disabled={!canApply}
              loading={apply.isPending}
              onClick={() =>
                rows &&
                apply.mutate(rows, {
                  onSuccess: (r) => {
                    setResult(r);
                    toast.success('Past records applied.');
                  },
                })
              }
            >
              Apply {data.recordsToAdd.toLocaleString('en-US')} {data.recordsToAdd === 1 ? 'record' : 'records'}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {data.errors.length > 0
                ? 'Fix the errors first: nothing is applied while any remain.'
                : data.recordsToAdd === 0
                  ? 'Everything in this file is already recorded.'
                  : 'Applied in one go: either every record is saved or none is.'}
            </span>
          </div>
          {apply.isError && (
            <div style={{ marginTop: 10 }}>
              <Callout tone="red">{(apply.error as Error).message}</Callout>
            </div>
          )}
        </Step>
      )}

      {result && (
        <Card padding={16}>
          <Callout tone="green" icon={<CheckCircle2 size={15} />}>
            <strong>Done.</strong> Added {result.eventsAdded} {result.eventsAdded === 1 ? 'record' : 'records'} to the timelines
            {result.appraisalsAdded > 0 ? ` and ${result.appraisalsAdded} past ${result.appraisalsAdded === 1 ? 'appraisal' : 'appraisals'}` : ''}
            {result.alreadyRecorded > 0 ? `; ${result.alreadyRecorded} already recorded and skipped` : ''}. {result.employeesUpdated}{' '}
            {result.employeesUpdated === 1 ? 'employee was' : 'employees were'} updated from their history.
          </Callout>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Link to="/people">
              <Button variant="accent">Back to employees</Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setFile(null);
                setRows(null);
                setResult(null);
                preview.reset();
                apply.reset();
              }}
            >
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
