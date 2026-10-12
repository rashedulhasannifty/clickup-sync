import { useState } from 'react';
import { Check, ClipboardList, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import type { OnboardingGroup, OnboardingGroupView, OnboardingItem, OnboardingItemPatch } from '../../api/onboarding';
import { isDocumentsDisabled } from '../../api/documents';
import { useDocumentMutations, useEmployeeDocuments } from '../../hooks/useDocuments';
import { useOnboarding, useOnboardingMutations } from '../../hooks/useOnboarding';
import { formatDate } from '../../lib/people';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Checkbox } from '../ui/Checkbox';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/Input';
import { Pill } from '../ui/Pill';
import { QueryError } from '../ui/QueryError';
import { TableSkeleton } from '../ui/TableSkeleton';
import { useToast } from '../ui/Toast';
import { DocumentViewerModal } from './DocumentViewerModal';
import { UploadDocumentModal } from './DocumentModals';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** Groups whose items carry a free-text detail (laptop serial, SIM number, email address). */
const DETAIL_PLACEHOLDER: Partial<Record<OnboardingGroup, string>> = {
  EQUIPMENT: 'Serial / asset tag / number',
  ACCOUNTS: 'Username / email address',
};

const ADD_PLACEHOLDER: Record<OnboardingGroup, string> = {
  DOCUMENTS: 'Add a document, e.g. Driving licence',
  EQUIPMENT: 'Add equipment, e.g. Monitor',
  ACCOUNTS: 'Add an account, e.g. GitHub',
  WELCOME: 'Add a welcome item',
};

/** A text field that saves when it loses focus, and only if the value changed. */
function BlurField({
  value, placeholder, ariaLabel, maxLength, onSave,
}: {
  value: string | null;
  placeholder: string;
  ariaLabel: string;
  maxLength: number;
  onSave: (v: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  // A saved value coming back from the server resets the field (derived state, not an effect).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value ?? '');
  }
  return (
    <Input
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim() || null;
        if (next !== (value ?? null)) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={{ height: 28, fontSize: 12.5 }}
    />
  );
}

function meta(item: OnboardingItem): string | null {
  if (item.done && item.doneAt) return `Done ${formatDate(item.doneAt.slice(0, 10))}${item.doneByName ? ` · ${item.doneByName}` : ''}`;
  if (item.notApplicable && item.notApplicableAt)
    return `Marked N/A ${formatDate(item.notApplicableAt.slice(0, 10))}${item.notApplicableByName ? ` · ${item.notApplicableByName}` : ''}`;
  return null;
}

function ProgressBar({ resolved, total }: { resolved: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={resolved} aria-label="Onboarding progress"
      style={{ height: 6, borderRadius: 999, background: 'var(--muted-bg)', overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: resolved === total ? 'var(--green)' : 'var(--accent)', transition: 'width 200ms' }} />
    </div>
  );
}

function ItemRow({
  item, editable, canUpload, onPatch, onRemove, onUpload, onView,
}: {
  item: OnboardingItem;
  editable: boolean;
  canUpload: boolean;
  onPatch: (patch: OnboardingItemPatch) => void;
  onRemove: () => void;
  onUpload: () => void;
  onView: () => void;
}) {
  const muted = item.done || item.notApplicable;
  const detailPlaceholder = DETAIL_PLACEHOLDER[item.group];
  const sub = meta(item);
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ paddingTop: 2 }}>
        {editable && !item.notApplicable ? (
          <Checkbox checked={item.done} label={`${item.label}: ${item.done ? 'done' : 'open'}`} onChange={() => onPatch({ done: !item.done })} />
        ) : item.done ? (
          <Check size={15} style={{ color: 'var(--green)' }} aria-label="done" />
        ) : item.notApplicable ? (
          <span aria-label="not applicable" style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600 }}>—</span>
        ) : (
          <X size={15} style={{ color: 'var(--text-faint)' }} aria-label="open" />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ textDecoration: item.done ? 'line-through' : undefined, color: muted ? 'var(--text-muted)' : undefined, overflowWrap: 'anywhere' }}>
            {item.label}
          </span>
          {item.notApplicable && <Pill tone="gray" size="xs">N/A</Pill>}
          {item.custom && <Pill tone="purple" size="xs">Custom</Pill>}
          {item.documentStatus === 'linked' && item.document && (
            <button
              type="button" onClick={onView} title="View document"
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent)', maxWidth: 240 }}
            >
              <FileText size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline' }}>{item.document.fileName}</span>
            </button>
          )}
          {item.documentStatus === 'removed' && (
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Linked document was deleted</span>
          )}
        </div>
        {sub && <small style={{ color: 'var(--text-faint)', marginTop: -4 }}>{sub}</small>}

        {editable ? (
          <div style={{ display: 'grid', gridTemplateColumns: detailPlaceholder ? 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' : '1fr', gap: 6 }}>
            {detailPlaceholder && (
              <BlurField value={item.detail} placeholder={detailPlaceholder} ariaLabel={`${item.label} detail`} maxLength={500} onSave={(detail) => onPatch({ detail })} />
            )}
            <BlurField value={item.note} placeholder="Note" ariaLabel={`${item.label} note`} maxLength={1000} onSave={(note) => onPatch({ note })} />
          </div>
        ) : (
          (item.detail || item.note) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {[item.detail, item.note].filter(Boolean).join(' · ')}
            </div>
          )
        )}
      </div>

      {editable && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
          {item.group === 'DOCUMENTS' && canUpload && !item.notApplicable && (
            <Button size="sm" variant="ghost" icon={<Upload size={12} />} onClick={onUpload} title="Upload and link a document">
              {item.documentStatus === 'linked' ? 'Upload new' : 'Upload'}
            </Button>
          )}
          <Button
            size="sm" variant="ghost"
            onClick={() => onPatch({ notApplicable: !item.notApplicable })}
            title={item.notApplicable ? 'Undo not applicable' : 'Mark not applicable'}
          >
            {item.notApplicable ? 'Undo N/A' : 'N/A'}
          </Button>
          {item.custom && (
            <Button size="iconSm" variant="ghost" aria-label={`Remove ${item.label}`} title="Remove custom item" icon={<Trash2 size={13} />} onClick={onRemove} />
          )}
        </div>
      )}
    </li>
  );
}

function AddItemForm({ group, onAdd, pending }: { group: OnboardingGroup; onAdd: (label: string, reset: () => void) => void; pending: boolean }) {
  const [label, setLabel] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = label.trim();
        if (text) onAdd(text, () => setLabel(''));
      }}
      style={{ display: 'flex', gap: 8, marginTop: 10 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder={ADD_PLACEHOLDER[group]} aria-label={`New ${group.toLowerCase()} item`} />
      </div>
      <Button type="submit" variant="default" loading={pending} icon={<Plus size={13} />}>
        Add
      </Button>
    </form>
  );
}

/**
 * The Onboarding tab: the company's "Check List of Joining" — documents to collect, equipment,
 * accounts and welcome items. Uploading from a document line reuses the Documents upload dialog,
 * pre-filled, and links the new file to the line. An exited employee's checklist is read-only.
 */
export function EmployeeOnboardingTab({ employeeId, readOnly = false }: { employeeId: string; readOnly?: boolean }) {
  const toast = useToast();
  const query = useOnboarding(employeeId);
  const m = useOnboardingMutations(employeeId);
  const docs = useEmployeeDocuments(employeeId);
  const docMutations = useDocumentMutations(employeeId);
  const [uploadFor, setUploadFor] = useState<OnboardingItem | null>(null);
  const [viewing, setViewing] = useState<OnboardingItem['document']>(null);

  if (query.isLoading) return <TableSkeleton rows={8} />;
  if (query.isError || !query.data) return <QueryError query={query} what="the onboarding checklist" />;

  const view = query.data;
  const editable = !readOnly && !view.readOnly;
  const docsDisabled = docs.isError && isDocumentsDisabled(docs.error);
  const canUpload = !!docs.data && !docsDisabled;

  const patch = (item: OnboardingItem, p: OnboardingItemPatch) =>
    m.update.mutate({ itemId: item.id, patch: p }, { onError: (e) => toast.error(`Could not update “${item.label}”. ${errText(e)}`) });

  if (!view.started) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList size={20} strokeWidth={1.5} />}
          title="No joining checklist yet"
          body={
            editable
              ? 'Employees added before the checklist existed start without one. Start it to track documents, equipment, accounts and the welcome pack.'
              : 'No joining checklist was recorded for this employee.'
          }
          action={
            editable ? (
              <Button
                variant="accent" icon={<ClipboardList size={13} />} loading={m.start.isPending}
                onClick={() => m.start.mutate(undefined, { onError: (e) => toast.error(`Could not start the checklist. ${errText(e)}`) })}
              >
                Start onboarding checklist
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const groupCard = (g: OnboardingGroupView) => (
    <Card key={g.group} title={g.label} subtitle={`${g.resolved} of ${g.total} done or N/A`}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {g.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            editable={editable}
            canUpload={canUpload}
            onPatch={(p) => patch(item, p)}
            onRemove={() => m.remove.mutate(item.id, { onError: (e) => toast.error(`Could not remove the item. ${errText(e)}`) })}
            onUpload={() => setUploadFor(item)}
            onView={() => setViewing(item.document)}
          />
        ))}
        {g.items.length === 0 && <li style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No items.</li>}
      </ul>
      {editable && (
        <AddItemForm
          group={g.group}
          pending={m.add.isPending && m.add.variables?.group === g.group}
          onAdd={(label, reset) =>
            m.add.mutate({ group: g.group, label }, { onSuccess: reset, onError: (e) => toast.error(`Could not add the item. ${errText(e)}`) })
          }
        />
      )}
    </Card>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Joining checklist</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {view.resolved} of {view.total} done or not applicable
          </div>
        </div>
        <ProgressBar resolved={view.resolved} total={view.total} />
        {editable && docsDisabled && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Document storage isn't configured on this server, so documents can be ticked off but not uploaded here.
          </div>
        )}
        {!editable && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Former employee: the checklist can be viewed, not changed.</div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
        {view.groups.map(groupCard)}
      </div>

      {uploadFor && docs.data && (
        <UploadDocumentModal
          docTypes={docs.data.docTypes}
          defaultCategory={uploadFor.suggested?.category}
          defaultDocType={uploadFor.suggested?.docType}
          title={uploadFor.label}
          subtitle="The uploaded file is added to the employee's documents and linked to this checklist line."
          submitting={docMutations.upload.isPending || m.update.isPending}
          onClose={() => setUploadFor(null)}
          onSubmit={async (input) => {
            const item = uploadFor;
            const doc = await docMutations.upload.mutateAsync(input);
            try {
              await m.update.mutateAsync({ itemId: item.id, patch: { documentId: doc.id } });
            } catch (e) {
              // The file is safe in Documents; only the link failed.
              throw new Error(`The document was uploaded, but linking it to the checklist failed. ${errText(e)}`, { cause: e });
            }
            toast.success('Document uploaded and linked.');
          }}
        />
      )}
      {viewing && <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
