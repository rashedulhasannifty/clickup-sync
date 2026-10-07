import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useCompanyDocuments } from '../hooks/useDocuments';
import { isDocumentsDisabled, type CompanyDocumentRow, type CompanyStatusFilter, type DocumentCategory } from '../api/documents';
import { CATEGORIES, CATEGORY_LABELS, expiryPill, formatDate } from '../lib/documents';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { QueryError } from '../components/ui/QueryError';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { DocumentsDisabledNotice } from '../components/people/EmployeeDocumentsTab';
import { DocumentViewerModal } from '../components/people/DocumentViewerModal';

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' } as const;
const td = { padding: '9px 10px', fontSize: 13, borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' } as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'Status: all' },
  { value: 'expiring', label: 'Expiring ≤ 30 days' },
  { value: 'expired', label: 'Expired' },
  { value: 'missing', label: 'Missing required' },
];

/** People → Documents: every employee's documents in one place, with the alerts HR acts on. */
export function DocumentsPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<DocumentCategory | 'all'>('all');
  const [status, setStatus] = useState<CompanyStatusFilter | 'all'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewing, setViewing] = useState<{ id: string; fileName: string; contentType: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useCompanyDocuments({
    status: status === 'all' ? undefined : status,
    category: category === 'all' ? undefined : category,
    search: debounced || undefined,
    page,
    limit: pageSize,
  });

  const disabled = query.isError && isDocumentsDisabled(query.error);
  const counts = query.data?.counts;
  const changeStatus = (v: CompanyStatusFilter | 'all') => { setStatus(v); setPage(1); };
  const tile = (filter: CompanyStatusFilter | 'all') => () => changeStatus(filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Documents" description="Every employee's files in one place, with expiring and missing documents surfaced." />

      {disabled ? (
        <DocumentsDisabledNotice />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <MetricCard label="Total documents" value={counts?.total ?? '—'} loading={query.isLoading} onClick={tile('all')} />
            <MetricCard label="Expiring ≤ 30 days" value={counts?.expiring ?? '—'} loading={query.isLoading} onClick={tile('expiring')} />
            <MetricCard label="Expired" value={counts?.expired ?? '—'} loading={query.isLoading} onClick={tile('expired')} />
            <MetricCard
              label="Missing required" value={counts?.missing ?? '—'} loading={query.isLoading} onClick={tile('missing')}
              sublabel={counts ? `across ${counts.missingEmployees} employee${counts.missingEmployees === 1 ? '' : 's'}` : undefined}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ width: 260 }}>
              <Input icon={<Search size={14} />} placeholder="Search file or employee" aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select
              ariaLabel="Category" value={category} onChange={(v) => { setCategory(v as DocumentCategory | 'all'); setPage(1); }}
              options={[{ value: 'all', label: 'Category: all' }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
            />
            <Select ariaLabel="Status" value={status} onChange={(v) => changeStatus(v as CompanyStatusFilter | 'all')} options={STATUS_OPTIONS} />
          </div>

          <Card padding={0}>
            {query.isLoading ? (
              <TableSkeleton rows={8} />
            ) : query.isError || !query.data ? (
              <QueryError query={query} what="documents" />
            ) : query.data.rows.length === 0 ? (
              <EmptyState
                title={status === 'missing' ? 'Nothing missing' : 'No documents match'}
                body={status === 'all' && !debounced && category === 'all' ? 'Upload documents from an employee’s Documents tab.' : 'Try clearing a filter.'}
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr><th style={th}>Employee</th><th style={th}>Document</th><th style={th}>Category</th><th style={th}>Expires</th><th style={th}>Status</th></tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((r) => <Row key={r.kind === 'document' ? r.id : `${r.employee.id}:${r.requirement.key}`} row={r} onOpen={setViewing} />)}
                  </tbody>
                </table>
              </div>
            )}
            {query.data && query.data.total > 0 && (
              <Pagination page={page} pageSize={pageSize} total={query.data.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
            )}
          </Card>
        </>
      )}
      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function EmployeeCell({ id, name, exited }: { id: string; name: string; exited: boolean }) {
  return (
    <td style={td}>
      <Link to={`/people/${id}`} style={{ fontWeight: 500 }}>{name}</Link>
      {exited && <span style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>(former)</span>}
    </td>
  );
}

function Row({ row, onOpen }: { row: CompanyDocumentRow; onOpen: (d: { id: string; fileName: string; contentType: string }) => void }) {
  const exited = row.employee.status === 'EXITED';
  if (row.kind === 'missing') {
    return (
      <tr>
        <EmployeeCell id={row.employee.id} name={row.employee.fullName} exited={exited} />
        <td style={td}>{row.requirement.label}</td>
        <td style={td}>{CATEGORY_LABELS[row.requirement.category]}</td>
        <td style={td}>—</td>
        <td style={td}><Pill tone="red" size="xs">Missing</Pill></td>
      </tr>
    );
  }
  const pill = expiryPill(row.expiry, row.expiresOn);
  return (
    <tr>
      <EmployeeCell id={row.employee.id} name={row.employee.fullName} exited={exited} />
      <td style={td}>
        <button type="button" onClick={() => onOpen(row)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 500, textDecoration: 'underline', textDecorationColor: 'var(--border)' }}>
          {row.fileName}
        </button>
      </td>
      <td style={td}>{CATEGORY_LABELS[row.category]}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(row.expiresOn)}</td>
      <td style={td}>{pill ? <Pill tone={exited ? 'gray' : pill.tone} size="xs">{pill.status}</Pill> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
    </tr>
  );
}
