import { Link } from 'react-router-dom';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import type { PastAppraisalView } from '../../api/pastRecords';
import { documentsApi } from '../../api/documents';
import { useEmployeeAppraisals } from '../../hooks/useAppraisals';
import { usePastRecords } from '../../hooks/usePastRecords';
import { formatDate } from '../../lib/people';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Pill } from '../ui/Pill';
import { QueryError } from '../ui/QueryError';
import { TableSkeleton } from '../ui/TableSkeleton';
import { ACTION_LABEL, APPRAISAL_TYPE_LABEL, gradeTone, td, th } from '../../lib/appraisals';
import { AppraisalStatusPill, OutcomeCell, ScoreCell, TimingChip } from './AppraisalBits';

const iconButton = {
  all: 'unset',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 6,
  color: 'var(--text-muted)',
} as const;

/** Appraisals done on paper before this system, entered as past records. */
function PastAppraisals({
  rows,
  onEdit,
  onDelete,
}: {
  rows: PastAppraisalView[];
  onEdit?: (a: PastAppraisalView) => void;
  onDelete?: (a: PastAppraisalView) => void;
}) {
  return (
    <Card padding={16} title="Past appraisals (paper)" subtitle="Done before this system. Each counts as already appraised for the due date it stands for.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Done on</th>
              <th style={th}>Type</th>
              <th style={th}>Grade / marks</th>
              <th style={th}>Outcome</th>
              <th style={th}>Scan</th>
              {(onEdit || onDelete) && <th style={th} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {formatDate(a.conductedOn)}
                  {a.dueDate && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>For the {formatDate(a.dueDate)} due date</div>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {APPRAISAL_TYPE_LABEL[a.type]}
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Past appraisal (paper)</div>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {a.grade && (
                      <Pill tone={gradeTone(a.grade)} size="xs">
                        {a.grade}
                      </Pill>
                    )}
                    {a.marks != null && (
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {a.marks} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>/ 100</span>
                      </span>
                    )}
                    {!a.grade && a.marks == null && <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </span>
                </td>
                <td style={td}>
                  {a.outcome ?? (a.actions.length === 0 && !a.notes ? <span style={{ color: 'var(--text-faint)' }}>—</span> : null)}
                  {a.actions.length > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: a.outcome ? 2 : 0 }}>
                      Recommended: {a.actions.map((x) => ACTION_LABEL[x]).join(', ')}
                    </div>
                  )}
                  {a.notes && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.notes}</div>}
                </td>
                <td style={td}>
                  {a.document ? (
                    <a
                      href={documentsApi.contentUrl(a.document.id)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      <FileText size={12} /> {a.document.fileName}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>—</span>
                  )}
                </td>
                {(onEdit || onDelete) && (
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {onEdit && (
                      <button type="button" style={iconButton} title="Edit" aria-label="Edit past appraisal" onClick={() => onEdit(a)}>
                        <Pencil size={12} />
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" style={iconButton} title="Delete" aria-label="Delete past appraisal" onClick={() => onDelete(a)}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * The Appraisals tab on an employee's page: one row per cycle, linking to the
 * form, then the past (paper) appraisals, with edit and delete when allowed.
 */
export function EmployeeAppraisalsTab({
  employeeId,
  onEditPast,
  onDeletePast,
}: {
  employeeId: string;
  onEditPast?: (a: PastAppraisalView) => void;
  onDeletePast?: (a: PastAppraisalView) => void;
}) {
  const query = useEmployeeAppraisals(employeeId);
  const past = usePastRecords(employeeId);

  if (query.isLoading) return <TableSkeleton rows={4} />;
  if (query.isError || !query.data) return <QueryError query={query} what="appraisals" />;

  const rows = query.data;
  const pastRows = past.data?.appraisals ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Card padding={16}>
      {rows.length === 0 ? (
        <EmptyState
          title="No appraisals in this system yet"
          body={
            pastRows.length > 0
              ? 'Appraisals from launched cycles appear here. The paper ones are listed below.'
              : 'An appraisal appears here once the employee is included in a launched cycle. Paper appraisals from before can be added with Add past record.'
          }
          action={<Link to="/people/appraisals">Go to appraisal cycles</Link>}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Cycle</th>
                <th style={th}>Review period</th>
                <th style={th}>Type</th>
                <th style={th}>Score / grade</th>
                <th style={th}>Recommendation</th>
                <th style={th}>Status</th>
                <th style={th}>Signed off</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <Link to={`/people/appraisals/${r.id}`} style={{ fontWeight: 500 }}>
                      {r.cycleName}
                    </Link>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                    {r.dueDate && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        Due {formatDate(r.dueDate)}
                        <TimingChip timing={r.timing} />
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{APPRAISAL_TYPE_LABEL[r.appraisalType]}</td>
                  <td style={td}>
                    <ScoreCell score={r.score} />
                  </td>
                  <td style={td}>
                    <OutcomeCell
                      mode={r.scoringMode}
                      recommendation={r.recommendation}
                      actions={r.actions}
                      decision={r.approvalDecision}
                      designation={r.newDesignation}
                      internship={r.appraisalType === 'INTERNSHIP'}
                      internshipOutcome={r.internshipOutcome}
                    />
                  </td>
                  <td style={td}>
                    <AppraisalStatusPill status={r.status} mode={r.scoringMode} />
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.signedOffAt ? formatDate(r.signedOffAt.slice(0, 10)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
    {pastRows.length > 0 && <PastAppraisals rows={pastRows} onEdit={onEditPast} onDelete={onDeletePast} />}
    </div>
  );
}
