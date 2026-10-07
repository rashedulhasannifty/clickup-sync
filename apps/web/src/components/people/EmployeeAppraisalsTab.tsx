import { Link } from 'react-router-dom';
import { useEmployeeAppraisals } from '../../hooks/useAppraisals';
import { formatDate } from '../../lib/people';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { QueryError } from '../ui/QueryError';
import { TableSkeleton } from '../ui/TableSkeleton';
import { td, th } from '../../lib/appraisals';
import { AppraisalStatusPill, RecommendationText, ScoreCell } from './AppraisalBits';

/** The Appraisals tab on an employee's page: one row per cycle, linking to the form. */
export function EmployeeAppraisalsTab({ employeeId }: { employeeId: string }) {
  const query = useEmployeeAppraisals(employeeId);

  if (query.isLoading) return <TableSkeleton rows={4} />;
  if (query.isError || !query.data) return <QueryError query={query} what="appraisals" />;

  const rows = query.data;
  return (
    <Card padding={16}>
      {rows.length === 0 ? (
        <EmptyState
          title="No appraisals yet"
          body="An appraisal appears here once the employee is included in a launched cycle."
          action={<Link to="/people/appraisals">Go to appraisal cycles</Link>}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Cycle</th>
                <th style={th}>Period</th>
                <th style={th}>Score</th>
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
                  </td>
                  <td style={td}>
                    <ScoreCell score={r.score} />
                  </td>
                  <td style={td}>
                    <RecommendationText value={r.recommendation} designation={r.newDesignation} />
                  </td>
                  <td style={td}>
                    <AppraisalStatusPill status={r.status} />
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.signedOffAt ? formatDate(r.signedOffAt.slice(0, 10)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
