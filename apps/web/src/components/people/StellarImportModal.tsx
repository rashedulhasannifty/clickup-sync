import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, FileUp, UploadCloud } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Pill } from '../ui/Pill';
import {
  detectStellarExport,
  type AttendanceImportResult,
  type LeaveImportResult,
  type StellarExportKind,
  type UnmatchedStellarUser,
} from '../../api/people';
import { useStellarImport } from '../../hooks/usePeople';
import { formatDateSpan, formatDays, LEAVE_TYPE_LABEL } from '../../lib/people';

const MAX_BYTES = 10 * 1024 * 1024;

type Result = AttendanceImportResult | LeaveImportResult;

const FLAG_LABEL: Record<string, string> = {
  weekend: 'on a weekend (skipped)',
  'unknown-type': 'unknown leave type, imported as Other',
  'unknown-status': 'unknown status (skipped)',
  'bad-date': 'unreadable date (skipped)',
  'no-user-id': 'no Stellar ID in the name (skipped)',
};

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'warn' ? 'var(--pill-amber-text)' : tone === 'muted' ? 'var(--text-muted)' : 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))', gap: 8 } as const;
const listBox = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  maxHeight: 220,
  overflowY: 'auto' as const,
  fontSize: 12.5,
};
const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderTop: '1px solid var(--border)' } as const;

function Unmatched({ users, unit }: { users: UnmatchedStellarUser[]; unit: string }) {
  if (users.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, margin: '4px 0 6px' }}>
        Not matched ({users.length}) · set their Stellar ID on the employee to include them
      </div>
      <div style={listBox}>
        {users.map((u, i) => (
          <div key={u.attendanceId} style={{ ...rowStyle, borderTop: i === 0 ? 'none' : rowStyle.borderTop }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>#{u.attendanceId}</span>{' '}
              {u.name || '—'}
              {u.department && <span style={{ color: 'var(--text-faint)' }}> · {u.department}</span>}
            </span>
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {u.count} {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendancePreview({ r }: { r: AttendanceImportResult }) {
  const t = r.totals;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={statGrid}>
        <Stat label="Matched employees" value={r.matched.length} />
        <Stat label="Unmatched Stellar IDs" value={r.unmatched.length} tone={r.unmatched.length ? 'warn' : 'muted'} />
        <Stat label="Days to write" value={t.rowsToWrite} />
        <Stat label="Simulated days replaced" value={t.replacedDummy} tone="muted" />
        <Stat label="Earlier import replaced" value={t.replacedCsv} tone="muted" />
        <Stat label="Simulated leave removed" value={t.dummyLeavesDeleted} tone="muted" />
      </div>
      {(t.keptApi > 0 || t.outsideEmployment > 0 || r.file.invalidRows > 0) && (
        <Callout tone="neutral">
          {[
            t.keptApi > 0 && `${t.keptApi} day(s) already hold Stellar API data and are left alone.`,
            t.outsideEmployment > 0 && `${t.outsideEmployment} day(s) fall outside employment and are skipped.`,
            r.file.invalidRows > 0 && `${r.file.invalidRows} row(s) could not be read.`,
          ]
            .filter(Boolean)
            .join(' ')}
        </Callout>
      )}
      {r.matched.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: '4px 0 6px' }}>Matched</div>
          <div style={listBox}>
            {r.matched.map((m, i) => (
              <div key={m.employeeId} style={{ ...rowStyle, borderTop: i === 0 ? 'none' : rowStyle.borderTop }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>#{m.attendanceId}</span> {m.fullName}
                  {m.department && <span style={{ color: 'var(--text-faint)' }}> · {m.department}</span>}
                </span>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {m.presentDays} in · {m.noPunchDays} no punch{m.weekendDays ? ` · ${m.weekendDays} weekend` : ''}
                  {m.replacedDummy + m.replacedCsv > 0 ? ` · replaces ${m.replacedDummy + m.replacedCsv}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <Unmatched users={r.unmatched} unit="days" />
    </div>
  );
}

function LeavePreview({ r }: { r: LeaveImportResult }) {
  const t = r.totals;
  const flags = [...r.warnings, ...r.skipped];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={statGrid}>
        <Stat label="Matched employees" value={r.matched.length} />
        <Stat label="Unmatched Stellar IDs" value={r.unmatched.length} tone={r.unmatched.length ? 'warn' : 'muted'} />
        <Stat label="Leave records" value={t.records} />
        <Stat label="Approved days" value={t.approvedDays} />
        <Stat label="Rejected days" value={t.rejectedDays} tone="muted" />
        <Stat label="Replaced (earlier import / simulated)" value={`${t.replacedStellar} / ${t.dummyLeavesDeleted}`} tone="muted" />
        {t.keptStellar > 0 && (
          <Stat label="Kept: decided in the app or running past this file" value={t.keptStellar} tone="muted" />
        )}
      </div>
      {flags.length > 0 && (
        <Callout tone="warning" icon={<AlertTriangle size={14} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {flags.map((f, i) => (
              <span key={i}>
                {f.name || '—'}
                {f.attendanceId ? ` (#${f.attendanceId})` : ''}
                {f.date ? `, ${f.date}` : ''}: {f.rawType ? `${f.rawType}, ` : ''}
                {FLAG_LABEL[f.reason] ?? f.reason}
              </span>
            ))}
          </div>
        </Callout>
      )}
      {r.matched.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: '4px 0 6px' }}>Records to add</div>
          <div style={listBox}>
            {r.matched.flatMap((m) =>
              m.records.map((rec, i) => (
                <div key={`${m.employeeId}-${rec.startDate}-${rec.type}-${rec.status}-${i}`} style={rowStyle}>
                  <span style={{ minWidth: 0 }}>
                    {m.fullName} · {LEAVE_TYPE_LABEL[rec.type]}
                    {rec.type === 'OTHER' && rec.rawType ? ` (${rec.rawType})` : ''}
                    {rec.description && (
                      <span title={rec.description} style={{ color: 'var(--text-faint)' }}>
                        {' '}
                        · {rec.description.length > 40 ? `${rec.description.slice(0, 40)}…` : rec.description}
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                    {formatDateSpan(rec.startDate, rec.endDate)} · {formatDays(rec.days)}
                    <Pill tone={rec.status === 'APPROVED' ? 'green' : rec.status === 'REJECTED' ? 'red' : 'gray'} size="xs">
                      {rec.status.toLowerCase()}
                    </Pill>
                  </span>
                </div>
              )),
            )}
          </div>
        </div>
      )}
      <Unmatched users={r.unmatched} unit="records" />
    </div>
  );
}

/**
 * Import a Stellar HRM export: pick a file (attendance or leave, detected from
 * its header), preview a dry run, then confirm. Nothing is written until
 * "Import". Leave descriptions are shown here (Owner/Admin only) and never logged.
 */
export function StellarImportModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<StellarExportKind | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const run = useStellarImport();

  async function pick(f: File | null) {
    setPreview(null);
    setError('');
    setFile(f);
    setKind(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('The file is larger than 10 MB.');
    const k = await detectStellarExport(f);
    if (!k) return setError('This is not a Stellar HRM attendance or leave export (unrecognised header).');
    setKind(k);
    run.mutate(
      { file: f, kind: k, dryRun: true },
      {
        onSuccess: (r) => setPreview(r),
        onError: (e) => setError(errorText(e)),
      },
    );
  }

  function confirm() {
    if (!file || !kind) return;
    run.mutate(
      { file, kind, dryRun: false },
      {
        onSuccess: (r) => {
          if (r.kind === 'attendance') {
            const a = r.applied;
            onDone(`Imported ${a?.inserted ?? 0} attendance days for ${r.matched.length} employees${r.range ? ` (${formatDateSpan(r.range.from, r.range.to)})` : ''}.`);
          } else {
            onDone(`Imported ${r.applied?.inserted ?? 0} leave records for ${r.matched.length} employees.`);
          }
          onClose();
        },
        onError: (e) => setError(errorText(e)),
      },
    );
  }

  const writes = preview ? (preview.kind === 'attendance' ? preview.totals.rowsToWrite : preview.totals.records) : 0;

  return (
    <Modal
      onClose={onClose}
      title="Import from Stellar HRM"
      subtitle="An attendance or leave CSV export. Preview first; nothing changes until you import."
      width={680}
      onSubmit={confirm}
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
          <Button
            type="submit"
            variant="accent"
            icon={<Check size={13} strokeWidth={2} />}
            loading={run.isPending && run.variables?.dryRun === false}
            disabled={!preview || writes === 0 || run.isPending}
          >
            {preview ? `Import ${writes} ${preview.kind === 'attendance' ? 'days' : 'records'}` : 'Import'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
            border: `2px dashed ${over ? 'var(--accent, #7B68EE)' : 'var(--border)'}`,
            borderRadius: 10,
            padding: 18,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          <UploadCloud size={20} style={{ marginBottom: 6 }} />
          <div>
            {file ? <strong style={{ color: 'var(--text)' }}>{file.name}</strong> : 'Drop the CSV here or '}
            <button
              type="button"
              onClick={() => input.current?.click()}
              style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {file ? ' · choose another' : 'browse'}
            </button>
          </div>
          <div style={{ fontSize: 11.5, marginTop: 4 }}>
            {kind ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <FileUp size={12} /> {kind === 'attendance' ? 'Attendance export' : 'Leave export'}
                {preview?.range ? ` · ${formatDateSpan(preview.range.from, preview.range.to)}` : ''}
              </span>
            ) : (
              'Stellar HRM attendance or leave export · CSV · max 10 MB'
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              void pick(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>

        {run.isPending && run.variables?.dryRun && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading the file…</div>}

        {preview?.kind === 'attendance' && <AttendancePreview r={preview} />}
        {preview?.kind === 'leaves' && <LeavePreview r={preview} />}

        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
          Matching is by Stellar ID only. Attendance replaces simulated and earlier imported days over the file’s dates
          (never Stellar API data) and removes simulated leave there. Leave replaces earlier imported leave, never leave
          entered by hand.
        </div>
      </div>
    </Modal>
  );
}

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.join(' ');
  return (e as Error).message ?? 'Something went wrong.';
}
