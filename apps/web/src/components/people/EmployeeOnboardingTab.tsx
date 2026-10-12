import { useState } from 'react';
import {
  Check, ChevronDown, ClipboardList, FileText, Gift, KeyRound, Laptop, MinusCircle, Plus, Trash2, Undo2, Upload,
} from 'lucide-react';
import type { OnboardingGroup, OnboardingGroupView, OnboardingItem, OnboardingItemPatch } from '../../api/onboarding';
import { isDocumentsDisabled } from '../../api/documents';
import { useDocumentMutations, useEmployeeDocuments } from '../../hooks/useDocuments';
import { useOnboarding, useOnboardingMutations } from '../../hooks/useOnboarding';
import { formatDate } from '../../lib/people';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/Input';
import { QueryError } from '../ui/QueryError';
import { TableSkeleton } from '../ui/TableSkeleton';
import { useToast } from '../ui/Toast';
import { DocumentViewerModal } from './DocumentViewerModal';
import { UploadDocumentModal } from './DocumentModals';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** How each stage of joining is presented: its icon and the one line that says what it is for. */
const STAGE: Record<OnboardingGroup, { icon: typeof FileText; blurb: string; add: string }> = {
  DOCUMENTS: { icon: FileText, blurb: 'Papers to collect from the new employee', add: 'Add a document, e.g. Driving licence' },
  EQUIPMENT: { icon: Laptop, blurb: 'What the office hands over on day one', add: 'Add equipment, e.g. Monitor' },
  ACCOUNTS: { icon: KeyRound, blurb: 'Logins and access to set up', add: 'Add an account, e.g. GitHub' },
  WELCOME: { icon: Gift, blurb: 'The welcome pack', add: 'Add a welcome item' },
};

/** Groups whose items carry a free-text detail (laptop serial, SIM number, email address). */
const DETAIL_PLACEHOLDER: Partial<Record<OnboardingGroup, string>> = {
  EQUIPMENT: 'Serial number, asset tag or SIM number',
  ACCOUNTS: 'Username or email address',
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
    />
  );
}

/** A small ring showing how much of a stage is settled; a tick once it all is. */
function Ring({ resolved, total, active }: { resolved: number; total: number; active: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : resolved / total;
  const complete = total > 0 && resolved === total;
  const stroke = complete ? 'var(--green)' : 'var(--accent)';
  return (
    <svg width={38} height={38} viewBox="0 0 38 38" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx={19} cy={19} r={r} fill={complete ? 'var(--pill-green-bg)' : active ? 'var(--accent-soft)' : 'none'} stroke="var(--border)" strokeWidth={3} />
      <circle
        cx={19} cy={19} r={r} fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round"
        strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 19 19)"
        style={{ transition: 'stroke-dasharray 300ms ease' }}
      />
      {complete && <path d="M13 19.5l4 4 8-9" fill="none" stroke="var(--green)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function who(at: string | null, name: string | null) {
  if (!at) return null;
  return `${formatDate(at.slice(0, 10))}${name ? ` by ${name}` : ''}`;
}

/** The round tick at the start of a row. It is the main control: one click marks the line done. */
function Tick({ item, editable, onToggle }: { item: OnboardingItem; editable: boolean; onToggle: () => void }) {
  const size = 24;
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 140ms, border-color 140ms, transform 140ms',
  } as const;
  if (item.notApplicable) {
    return (
      <span aria-label="Not needed" title="Not needed" style={{ ...base, color: 'var(--text-faint)' }}>
        <MinusCircle size={20} strokeWidth={1.6} />
      </span>
    );
  }
  const face = {
    ...base,
    background: item.done ? 'var(--green)' : 'var(--surface)',
    border: item.done ? '1.5px solid var(--green)' : '1.5px solid var(--border-strong)',
    color: '#fff',
  };
  if (!editable) {
    return <span aria-label={item.done ? 'Done' : 'Not done yet'} style={face}>{item.done && <Check size={14} strokeWidth={3} />}</span>;
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={item.done}
      aria-label={`${item.label}: ${item.done ? 'done' : 'not done yet'}`}
      onClick={onToggle}
      className="onb-tick"
      style={{ ...face, cursor: 'pointer', padding: 0 }}
    >
      {item.done && <Check size={14} strokeWidth={3} />}
    </button>
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
  const [open, setOpen] = useState(false);
  const detailPlaceholder = DETAIL_PLACEHOLDER[item.group];
  const settled = item.done || item.notApplicable;
  const status = item.done
    ? `Done ${who(item.doneAt, item.doneByName) ?? ''}`.trim()
    : item.notApplicable
      ? `Not needed${item.notApplicableAt ? ` · marked ${who(item.notApplicableAt, item.notApplicableByName)}` : ''}`
      : null;
  const context = [item.detail, item.note].filter(Boolean).join(' · ');
  const canExpand = editable && !item.notApplicable;
  const showUpload = editable && item.group === 'DOCUMENTS' && canUpload && !item.notApplicable;

  return (
    <li className="onb-row" style={{ borderTop: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px' }}>
        <Tick item={item} editable={editable} onToggle={() => onPatch({ done: !item.done })} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: settled ? 'var(--text-muted)' : 'var(--text)', overflowWrap: 'anywhere' }}>
              {item.label}
            </span>
            {item.custom && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 999, padding: '0 7px' }}>
                Added
              </span>
            )}
          </div>
          {(status || context || item.documentStatus !== 'none') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 3, fontSize: 12, color: 'var(--text-muted)' }}>
              {item.documentStatus === 'linked' && item.document && (
                <button
                  type="button" onClick={onView} title="Open the document"
                  style={{
                    all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 260,
                    padding: '1px 8px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent-strong)', fontWeight: 500,
                  }}
                >
                  <FileText size={12} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.document.fileName}</span>
                </button>
              )}
              {item.documentStatus === 'removed' && <span style={{ color: 'var(--text-faint)' }}>The linked document was deleted</span>}
              {context && <span style={{ overflowWrap: 'anywhere' }}>{context}</span>}
              {status && <span style={{ color: 'var(--text-faint)' }}>{status}</span>}
            </div>
          )}
        </div>

        {editable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            {showUpload && (
              <Button size="sm" variant={item.documentStatus === 'linked' ? 'ghost' : 'default'} icon={<Upload size={13} />} onClick={onUpload}>
                {item.documentStatus === 'linked' ? 'Replace' : 'Upload'}
              </Button>
            )}
            <Button
              size="sm" variant="ghost" className="onb-quiet"
              icon={item.notApplicable ? <Undo2 size={13} /> : undefined}
              onClick={() => onPatch({ notApplicable: !item.notApplicable })}
              title={item.notApplicable ? 'Put this line back on the checklist' : 'This line does not apply to this employee'}
            >
              {item.notApplicable ? 'Restore' : 'Not needed'}
            </Button>
            {canExpand && (
              <Button
                size="iconSm" variant="ghost" className={open ? undefined : 'onb-quiet'}
                aria-expanded={open}
                aria-label={open ? `Hide details for ${item.label}` : `Add details to ${item.label}`}
                title={open ? 'Hide details' : detailPlaceholder ? 'Add details and a note' : 'Add a note'}
                icon={<ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 160ms' }} />}
                onClick={() => setOpen((o) => !o)}
              />
            )}
            {item.custom && (
              <Button size="iconSm" variant="ghost" aria-label={`Remove ${item.label}`} title="Remove this line" icon={<Trash2 size={13} />} onClick={onRemove} />
            )}
          </div>
        )}
      </div>

      {open && canExpand && (
        <div
          style={{
            display: 'grid', gap: 8, margin: '0 4px 12px 40px', padding: 12, borderRadius: 'var(--radius)',
            background: 'var(--surface-alt)', border: '1px solid var(--border-soft)',
            gridTemplateColumns: detailPlaceholder ? 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' : '1fr',
          }}
        >
          {detailPlaceholder && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              Details
              <BlurField value={item.detail} placeholder={detailPlaceholder} ariaLabel={`${item.label} details`} maxLength={500} onSave={(detail) => onPatch({ detail })} />
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            Note
            <BlurField value={item.note} placeholder="Anything HR should remember" ariaLabel={`${item.label} note`} maxLength={1000} onSave={(note) => onPatch({ note })} />
          </label>
        </div>
      )}
    </li>
  );
}

/** A dashed "add a line" row that turns into a field when clicked. */
function AddLine({ group, onAdd, pending }: { group: OnboardingGroup; onAdd: (label: string, reset: () => void) => void; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="onb-add"
        style={{
          all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%', marginTop: 8,
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderRadius: 'var(--radius)',
          border: '1px dashed var(--border-strong)', color: 'var(--text-muted)', fontSize: 13, justifyContent: 'center',
        }}
      >
        <Plus size={14} /> Add a line
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = label.trim();
        if (text) onAdd(text, () => { setLabel(''); setEditing(false); });
      }}
      style={{ display: 'flex', gap: 8, marginTop: 8 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Input
          autoFocus value={label} maxLength={200} placeholder={STAGE[group].add} aria-label="New checklist line"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setLabel(''); setEditing(false); } }}
        />
      </div>
      <Button type="submit" variant="accent" loading={pending} icon={<Plus size={13} />}>Add</Button>
      <Button type="button" variant="ghost" onClick={() => { setLabel(''); setEditing(false); }}>Cancel</Button>
    </form>
  );
}

/**
 * The Onboarding tab: the company's "Check List of Joining" — documents to collect, equipment,
 * accounts and welcome items. The four stages across the top are both the progress and the
 * navigation; one stage's lines are shown at a time. Uploading from a document line reuses the
 * Documents upload dialog, pre-filled, and links the new file to the line. An exited employee's
 * checklist is read-only.
 */
export function EmployeeOnboardingTab({ employeeId, readOnly = false }: { employeeId: string; readOnly?: boolean }) {
  const toast = useToast();
  const query = useOnboarding(employeeId);
  const m = useOnboardingMutations(employeeId);
  const docs = useEmployeeDocuments(employeeId);
  const docMutations = useDocumentMutations(employeeId);
  const [uploadFor, setUploadFor] = useState<OnboardingItem | null>(null);
  const [viewing, setViewing] = useState<OnboardingItem['document']>(null);
  const [stage, setStage] = useState<OnboardingGroup | null>(null);

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
              ? 'Start the checklist to track the documents to collect, the equipment handed over, the accounts to set up and the welcome pack.'
              : 'No joining checklist was recorded for this employee.'
          }
          action={
            editable ? (
              <Button
                variant="accent" icon={<ClipboardList size={13} />} loading={m.start.isPending}
                onClick={() => m.start.mutate(undefined, { onError: (e) => toast.error(`Could not start the checklist. ${errText(e)}`) })}
              >
                Start the joining checklist
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  // Open on the first stage with something left to do, so the tab always lands where the work is.
  const firstOpen = view.groups.find((g) => g.resolved < g.total)?.group ?? view.groups[0]?.group;
  const current: OnboardingGroupView | undefined = view.groups.find((g) => g.group === (stage ?? firstOpen)) ?? view.groups[0];
  const left = view.total - view.resolved;
  const pct = view.total === 0 ? 0 : Math.round((view.resolved / view.total) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`
        .onb-tick:hover { border-color: var(--green) !important; }
        .onb-tick:focus-visible, .onb-stage:focus-visible, .onb-add:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .onb-stage:hover { border-color: var(--border-strong) !important; }
        .onb-quiet { opacity: .5; transition: opacity 120ms; }
        .onb-row:hover .onb-quiet, .onb-row:focus-within .onb-quiet { opacity: 1; }
        @media (hover: none) { .onb-quiet { opacity: 1; } }
        .onb-add:hover { color: var(--accent-strong) !important; border-color: var(--accent) !important; }
        @media (prefers-reduced-motion: reduce) { .onb-tick, .onb-stage { transition: none !important; } }
      `}</style>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {left === 0 ? 'Joining complete' : `${left} ${left === 1 ? 'thing' : 'things'} left before joining is complete`}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
              {editable
                ? 'Tick a line when it’s done. Mark it not needed if it doesn’t apply to this employee.'
                : 'Former employee: the checklist can be viewed, not changed.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-0.02em', color: left === 0 ? 'var(--green)' : 'var(--text)' }}>{pct}%</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{view.resolved} of {view.total}</span>
          </div>
        </div>

        <div role="tablist" aria-label="Joining stages" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 8 }}>
          {view.groups.map((g) => {
            const active = g.group === current?.group;
            const Icon = STAGE[g.group].icon;
            return (
              <button
                key={g.group}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStage(g.group)}
                className="onb-stage"
                style={{
                  all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--radius)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--selected-bg)' : 'var(--surface)',
                  boxShadow: active ? '0 0 0 3px var(--accent-soft)' : undefined,
                  transition: 'border-color 140ms, background 140ms',
                }}
              >
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <Ring resolved={g.resolved} total={g.total} active={active} />
                  {g.resolved < g.total && (
                    <Icon size={15} strokeWidth={1.8} style={{ position: 'absolute', inset: 0, margin: 'auto', color: active ? 'var(--accent-strong)' : 'var(--text-muted)' }} />
                  )}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{g.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {g.resolved === g.total ? 'All done' : `${g.resolved} of ${g.total}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {editable && docsDisabled && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            Document storage isn’t set up on this server, so documents can be ticked off here but not uploaded.
          </div>
        )}
      </Card>

      {current && (
        <Card>
          <div role="tabpanel" aria-label={current.label}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{current.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{STAGE[current.group].blurb}</div>
              </div>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {current.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  editable={editable}
                  canUpload={canUpload}
                  onPatch={(p) => patch(item, p)}
                  onRemove={() => m.remove.mutate(item.id, { onError: (e) => toast.error(`Could not remove the line. ${errText(e)}`) })}
                  onUpload={() => setUploadFor(item)}
                  onView={() => setViewing(item.document)}
                />
              ))}
              {current.items.length === 0 && (
                <li style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 4px', borderTop: '1px solid var(--border-soft)' }}>Nothing in this stage yet.</li>
              )}
            </ul>
            {editable && (
              <AddLine
                key={current.group}
                group={current.group}
                pending={m.add.isPending && m.add.variables?.group === current.group}
                onAdd={(label, reset) =>
                  m.add.mutate({ group: current.group, label }, { onSuccess: reset, onError: (e) => toast.error(`Could not add the line. ${errText(e)}`) })
                }
              />
            )}
          </div>
        </Card>
      )}

      {uploadFor && docs.data && (
        <UploadDocumentModal
          docTypes={docs.data.docTypes}
          defaultCategory={uploadFor.suggested?.category}
          defaultDocType={uploadFor.suggested?.docType}
          title={uploadFor.label}
          subtitle="The file is added to the employee's documents and linked to this checklist line."
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
