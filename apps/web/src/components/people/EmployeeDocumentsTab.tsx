import { useMemo, useState } from 'react';
import { Download, Eye, Maximize2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentMutations, useEmployeeDocuments } from '../../hooks/useDocuments';
import { isDocumentsDisabled, documentsApi, type DocumentCategory, type EmployeeDocument } from '../../api/documents';
import { CATEGORIES, CATEGORY_LABELS, docTypeLabel, expiryPill, formatBytes, formatDate, VISIBILITY_LABELS } from '../../lib/documents';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Pill } from '../ui/Pill';
import { QueryError } from '../ui/QueryError';
import { TableSkeleton } from '../ui/TableSkeleton';
import { useToast } from '../ui/Toast';
import { DocumentPreviewBody, DocumentViewerModal } from './DocumentViewerModal';
import { DeleteDocumentModal, EditDocumentModal, ReplaceDocumentModal, UploadDocumentModal } from './DocumentModals';

export function DocumentsDisabledNotice() {
  return (
    <Callout tone="warning">
      Employee documents aren't set up on this server yet. An administrator needs to configure the private document storage
      (the <code>DOCUMENTS_S3_*</code> settings in <code>.env.example</code>) before files can be uploaded or opened.
    </Callout>
  );
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' } as const;
const td = { padding: '9px 10px', fontSize: 13, borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' } as const;

type Modal =
  | { kind: 'upload' }
  | { kind: 'replace' | 'edit' | 'delete'; doc: EmployeeDocument };

/** The Documents tab on an employee's page: files, a preview pane and the required checklist. */
export function EmployeeDocumentsTab({ employeeId }: { employeeId: string }) {
  const { hasRole } = useAuth();
  const toast = useToast();
  const query = useEmployeeDocuments(employeeId);
  const mutations = useDocumentMutations(employeeId);
  const [category, setCategory] = useState<DocumentCategory | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const visible = useMemo(() => items.filter((d) => category === 'ALL' || d.category === category), [items, category]);
  const selected = useMemo(() => items.find((d) => d.id === selectedId) ?? visible[0] ?? null, [items, visible, selectedId]);

  if (query.isLoading) return <TableSkeleton rows={6} />;
  if (query.isError && isDocumentsDisabled(query.error)) return <DocumentsDisabledNotice />;
  if (query.isError || !query.data) return <QueryError query={query} what="documents" />;

  const { checklist, docTypes } = query.data;
  const canDelete = hasRole('OWNER');
  const typeLabel = (d: EmployeeDocument) => docTypeLabel(docTypes, d.docType);

  const run = async (label: string, p: Promise<unknown>) => {
    await p;
    toast.success(label);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 480px', minWidth: 0 }}>
      <Card padding={16}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div role="group" aria-label="Filter by category" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['ALL', ...CATEGORIES] as const).map((c) => {
              const count = c === 'ALL' ? items.length : items.filter((d) => d.category === c).length;
              if (c !== 'ALL' && count === 0 && category !== c) return null;
              return (
                <button
                  key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
                  style={{
                    padding: '4px 11px', borderRadius: 999, fontSize: 12.5, cursor: 'pointer',
                    border: '1px solid var(--border)', color: category === c ? 'var(--text)' : 'var(--text-muted)',
                    background: category === c ? 'var(--muted-bg)' : 'transparent', fontWeight: category === c ? 600 : 400,
                  }}
                >
                  {c === 'ALL' ? 'All' : CATEGORY_LABELS[c]} <span style={{ opacity: 0.6 }}>{count}</span>
                </button>
              );
            })}
          </div>
          <Button variant="primary" size="sm" icon={<Upload size={14} />} onClick={() => setModal({ kind: 'upload' })}>Upload</Button>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? 'No documents yet' : 'No documents in this category'}
            body={items.length === 0 ? 'Upload an ID, contract or certificate to start this employee’s file.' : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Document</th><th style={th}>Category</th><th style={th}>Uploaded</th><th style={th}>Expires</th><th style={th}>Visible to</th><th style={th} />
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const pill = expiryPill(d.expiry, d.expiresOn);
                  const active = selected?.id === d.id;
                  return (
                    <tr key={d.id} style={{ background: active ? 'var(--muted-bg)' : undefined }}>
                      <td style={td}>
                        <div style={{ fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.fileName}>{d.fileName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {typeLabel(d)} · {formatBytes(d.sizeBytes)}{d.version > 1 ? ` · v${d.version}` : ''}
                        </div>
                      </td>
                      <td style={td}>{CATEGORY_LABELS[d.category]}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(d.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {pill ? <Pill tone={pill.tone} size="xs">{pill.text}</Pill> : '—'}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{VISIBILITY_LABELS[d.visibility]}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <Button variant="ghost" size="iconSm" aria-label={`View ${d.fileName}`} title="View" onClick={() => setSelectedId(d.id)}><Eye size={14} /></Button>
                        <Button variant="ghost" size="iconSm" aria-label={`Replace ${d.fileName}`} title="Replace with a new version" onClick={() => setModal({ kind: 'replace', doc: d })}><RefreshCw size={14} /></Button>
                        <Button variant="ghost" size="iconSm" aria-label={`Edit ${d.fileName}`} title="Edit details" onClick={() => setModal({ kind: 'edit', doc: d })}><Pencil size={14} /></Button>
                        {canDelete && (
                          <Button variant="ghost" size="iconSm" aria-label={`Delete ${d.fileName}`} title="Delete (Owner only)" onClick={() => setModal({ kind: 'delete', doc: d })}><Trash2 size={14} /></Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
          Replacing keeps the old version. Deleting is Owner-only and recorded in the audit log.
        </p>
      </Card>
      </div>

      <div style={{ flex: '0 1 340px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title={selected ? `Preview · ${selected.fileName}` : 'Preview'} padding={14}>
          {selected ? (
            <>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, minHeight: 120, background: 'var(--muted-bg)', padding: 8 }}>
                <DocumentPreviewBody doc={selected} height={260} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <a href={documentsApi.contentUrl(selected.id, true)} download={selected.fileName} style={{ textDecoration: 'none' }}>
                  <Button size="sm" icon={<Download size={14} />}>Download</Button>
                </a>
                <Button size="sm" icon={<Maximize2 size={14} />} onClick={() => setFullscreen(true)}>Open full screen</Button>
              </div>
              {selected.previousVersions.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Older versions</div>
                  {selected.previousVersions.map((v) => (
                    <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
                      <span>v{v.version} · {formatDate(v.createdAt)}</span>
                      <a href={documentsApi.contentUrl(v.id, true)} download={v.fileName}>Download</a>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>PDFs and images open inline; other files download.</div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Select a document to preview it.</p>
          )}
        </Card>

        <Card title="Required checklist" padding={14}>
          {checklist.map((c, i) => (
            <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i === checklist.length - 1 ? 0 : '1px solid var(--border-soft)', fontSize: 13 }}>
              <span>{c.label}</span>
              {!c.satisfied ? <Pill tone="red" size="xs">Missing</Pill> : c.expiry === 'expired' ? <Pill tone="red" size="xs">Expired</Pill> : c.expiry === 'expiring' ? <Pill tone="amber" size="xs">Expiring</Pill> : <Pill tone="green" size="xs">✓</Pill>}
            </div>
          ))}
        </Card>
      </div>

      {modal?.kind === 'upload' && (
        <UploadDocumentModal
          docTypes={docTypes} defaultCategory={category === 'ALL' ? undefined : category}
          submitting={mutations.upload.isPending} onClose={() => setModal(null)}
          onSubmit={(input) => run('Document uploaded', mutations.upload.mutateAsync(input).then((d) => setSelectedId(d.id)))}
        />
      )}
      {modal?.kind === 'replace' && (
        <ReplaceDocumentModal
          doc={modal.doc} submitting={mutations.replace.isPending} onClose={() => setModal(null)}
          onSubmit={(file, expiresOn) => run('New version uploaded', mutations.replace.mutateAsync({ id: modal.doc.id, file, expiresOn }).then((d) => setSelectedId(d.id)))}
        />
      )}
      {modal?.kind === 'edit' && (
        <EditDocumentModal
          doc={modal.doc} docTypes={docTypes} submitting={mutations.update.isPending} onClose={() => setModal(null)}
          onSubmit={(patch) => run('Document updated', mutations.update.mutateAsync({ id: modal.doc.id, patch }))}
        />
      )}
      {modal?.kind === 'delete' && (
        <DeleteDocumentModal
          doc={modal.doc} submitting={mutations.remove.isPending} onClose={() => setModal(null)}
          onConfirm={() => run('Document deleted', mutations.remove.mutateAsync(modal.doc.id))}
        />
      )}
      {fullscreen && selected && <DocumentViewerModal doc={selected} onClose={() => setFullscreen(false)} />}
    </div>
  );
}
