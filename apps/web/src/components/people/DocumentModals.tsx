import { useMemo, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import type { DocTypeOption, DocumentCategory, DocumentVisibility, EmployeeDocument, UpdateInput, UploadInput } from '../../api/documents';
import { ACCEPT, CATEGORIES, CATEGORY_LABELS, formatBytes, MAX_UPLOAD_BYTES, VISIBILITIES, VISIBILITY_LABELS } from '../../lib/documents';

type DocTypes = Record<DocumentCategory, DocTypeOption[]>;

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** Checks only what the browser can know cheaply. The server re-checks size and the real file type. */
function fileProblem(file: File): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `That file is ${formatBytes(file.size)}. The limit is 20 MB.`;
  return null;
}

function FilePicker({ file, onPick, disabled }: { file: File | null; onPick: (f: File | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onPick(e.dataTransfer.files[0] ?? null); }}
      style={{
        border: `2px dashed ${over ? 'var(--accent, #7B68EE)' : 'var(--border)'}`, borderRadius: 10, padding: 22, textAlign: 'center',
        color: 'var(--text-muted)', fontSize: 13,
      }}
    >
      <UploadCloud size={20} style={{ marginBottom: 6 }} />
      <div>
        {file ? <strong style={{ color: 'var(--text)' }}>{file.name}</strong> : 'Drop a file here or '}
        {!file && (
          <button type="button" disabled={disabled} onClick={() => input.current?.click()} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>
            browse
          </button>
        )}
        {file && <> · {formatBytes(file.size)} · <button type="button" disabled={disabled} onClick={() => input.current?.click()} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>change</button></>}
      </div>
      <div style={{ fontSize: 11.5, marginTop: 4 }}>PDF, JPG, PNG, WebP, DOCX · max 20 MB</div>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    </div>
  );
}

interface CategoryFields {
  category: DocumentCategory;
  docType: string;
}

function CategoryDocType({ docTypes, value, onChange }: { docTypes: DocTypes; value: CategoryFields; onChange: (v: CategoryFields) => void }) {
  const options = docTypes[value.category] ?? [];
  return (
    <>
      <Field label="Category">
        <Select
          fullWidth ariaLabel="Category" value={value.category}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          onChange={(c) => onChange({ category: c as DocumentCategory, docType: docTypes[c as DocumentCategory]?.[0]?.key ?? 'OTHER' })}
        />
      </Field>
      <Field label="Document type">
        <Select fullWidth ariaLabel="Document type" value={value.docType} options={options.map((t) => ({ value: t.key, label: t.label }))} onChange={(docType) => onChange({ ...value, docType })} />
      </Field>
    </>
  );
}

const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as const;

export function UploadDocumentModal({
  docTypes, defaultCategory, defaultDocType, title = 'Upload document', subtitle, onClose, onSubmit, submitting,
}: {
  docTypes: DocTypes;
  defaultCategory?: DocumentCategory;
  /** Pre-selects a type in `defaultCategory` (ignored if the category doesn't offer it). */
  defaultDocType?: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: (input: UploadInput) => Promise<unknown>;
  submitting: boolean;
}) {
  const startCategory = defaultCategory ?? 'IDENTITY';
  const [file, setFile] = useState<File | null>(null);
  const startDocType =
    defaultDocType && docTypes[startCategory]?.some((t) => t.key === defaultDocType) ? defaultDocType : docTypes[startCategory]?.[0]?.key ?? 'OTHER';
  const [cat, setCat] = useState<CategoryFields>({ category: startCategory, docType: startDocType });
  const [expiresOn, setExpiresOn] = useState('');
  const [visibility, setVisibility] = useState<DocumentVisibility>('HR_ONLY');
  const [error, setError] = useState('');

  async function save() {
    if (!file) return setError('Choose a file to upload.');
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setError('');
    try {
      await onSubmit({ file, category: cat.category, docType: cat.docType, expiresOn: expiresOn || undefined, visibility });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open onClose={onClose} width={520} title={title} subtitle={subtitle} onSubmit={save}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={submitting}>Upload</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FilePicker file={file} onPick={(f) => { setFile(f); setError(''); }} disabled={submitting} />
        <div style={grid}>
          <CategoryDocType docTypes={docTypes} value={cat} onChange={setCat} />
          <Field label="Expiry date (optional)"><Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></Field>
          <Field label="Visible to" hint="Stored now; enforced when employee access arrives.">
            <Select fullWidth ariaLabel="Visible to" value={visibility} options={VISIBILITIES.map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }))} onChange={(v) => setVisibility(v as DocumentVisibility)} />
          </Field>
        </div>
        {error && <div role="alert" style={{ color: 'var(--pill-red-text)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  );
}

export function ReplaceDocumentModal({
  doc, onClose, onSubmit, submitting,
}: {
  doc: EmployeeDocument;
  onClose: () => void;
  onSubmit: (file: File, expiresOn?: string) => Promise<unknown>;
  submitting: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!file) return setError('Choose the new file.');
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setError('');
    try {
      await onSubmit(file, expiresOn || undefined);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open onClose={onClose} width={520} title="Replace with a new version" subtitle={`${doc.fileName} is version ${doc.version}. It stays available as an older version.`} onSubmit={save}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={submitting}>Upload version {doc.version + 1}</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FilePicker file={file} onPick={(f) => { setFile(f); setError(''); }} disabled={submitting} />
        <Field label="New expiry date" hint={doc.expiresOn ? `Leave blank to keep ${doc.expiresOn}.` : 'Optional.'}>
          <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
        {error && <div role="alert" style={{ color: 'var(--pill-red-text)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  );
}

export function EditDocumentModal({
  doc, docTypes, onClose, onSubmit, submitting,
}: {
  doc: EmployeeDocument;
  docTypes: DocTypes;
  onClose: () => void;
  onSubmit: (patch: UpdateInput) => Promise<unknown>;
  submitting: boolean;
}) {
  const [cat, setCat] = useState<CategoryFields>({ category: doc.category, docType: doc.docType });
  const [expiresOn, setExpiresOn] = useState(doc.expiresOn ?? '');
  const [visibility, setVisibility] = useState<DocumentVisibility>(doc.visibility);
  const [error, setError] = useState('');

  const patch = useMemo<UpdateInput>(() => {
    const p: UpdateInput = {};
    if (cat.category !== doc.category) p.category = cat.category;
    if (cat.docType !== doc.docType) p.docType = cat.docType;
    if ((expiresOn || null) !== doc.expiresOn) p.expiresOn = expiresOn || null;
    if (visibility !== doc.visibility) p.visibility = visibility;
    return p;
  }, [cat, expiresOn, visibility, doc]);

  async function save() {
    if (Object.keys(patch).length === 0) return onClose();
    try {
      await onSubmit(patch);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open onClose={onClose} width={520} title="Edit document" subtitle={doc.fileName} onSubmit={save}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={submitting}>Save</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={grid}>
          <CategoryDocType docTypes={docTypes} value={cat} onChange={setCat} />
          <Field label="Expiry date"><Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></Field>
          <Field label="Visible to">
            <Select fullWidth ariaLabel="Visible to" value={visibility} options={VISIBILITIES.map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }))} onChange={(v) => setVisibility(v as DocumentVisibility)} />
          </Field>
        </div>
        {error && <div role="alert" style={{ color: 'var(--pill-red-text)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  );
}

export function DeleteDocumentModal({
  doc, onClose, onConfirm, submitting,
}: {
  doc: EmployeeDocument;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
  submitting: boolean;
}) {
  const [error, setError] = useState('');
  async function confirm() {
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Modal
      open onClose={onClose} width={460} title="Delete this document?"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="danger" onClick={confirm} loading={submitting}>Delete</Button>
        </div>
      }
    >
      <p style={{ fontSize: 13, margin: 0 }}>
        <strong>{doc.fileName}</strong>
        {doc.previousVersions.length > 0 ? ` and its ${doc.previousVersions.length} older version${doc.previousVersions.length === 1 ? '' : 's'}` : ''} will be hidden from everyone.
        The stored file is kept, and the deletion is recorded in the audit log. Only an Owner can do this.
      </p>
      {error && <div role="alert" style={{ color: 'var(--pill-red-text)', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
