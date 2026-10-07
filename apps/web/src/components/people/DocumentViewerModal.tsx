import { useState } from 'react';
import { Download, ExternalLink, FileWarning } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { documentsApi } from '../../api/documents';
import { viewerKind } from '../../lib/attachmentPreview';

interface Props {
  doc: { id: string; fileName: string; contentType: string } | null;
  onClose: () => void;
}

export function Problem({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
      <FileWarning size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{text}</span>
    </div>
  );
}

/**
 * The inline preview body, shared by the small pane and the full-screen modal. Uses the same
 * decision as the Finance attachment viewer (`viewerKind`): only PDFs and raster images render;
 * anything else (DOCX) is a download. The server enforces the same rule, so this can't widen it.
 */
export function DocumentPreviewBody({ doc, height }: { doc: { id: string; fileName: string; contentType: string }; height: number | string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const kind = viewerKind(doc.fileName, doc.contentType);
  const url = documentsApi.contentUrl(doc.id);
  if (kind === 'pdf') {
    // No `sandbox`: Chromium's PDF viewer renders blank inside a sandboxed frame. Safe because the
    // server only serves allowlisted PDFs inline, with nosniff and a frame-ancestors-only CSP.
    return <iframe key={doc.id} title={doc.fileName} src={url} style={{ width: '100%', height, border: 0, borderRadius: 8, background: 'var(--surface)' }} />;
  }
  if (kind === 'image') {
    return imageFailed ? (
      <Problem text="Couldn't load this image. Try Download instead." />
    ) : (
      <img key={doc.id} src={url} alt={doc.fileName} onError={() => setImageFailed(true)} style={{ display: 'block', maxWidth: '100%', maxHeight: height, margin: '0 auto', borderRadius: 8 }} />
    );
  }
  return <Problem text="This file type can't be previewed here. Download it to open it on your computer." />;
}

/** Full-screen preview. Same viewer as the pane, plus Open in new tab / Download. */
export function DocumentViewerModal({ doc, onClose }: Props) {
  if (!doc) return null;
  const kind = viewerKind(doc.fileName, doc.contentType);
  return (
    <Modal
      open
      onClose={onClose}
      width={1000}
      title={doc.fileName}
      subtitle="Employee document"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
          {(kind === 'pdf' || kind === 'image') && (
            <a href={documentsApi.contentUrl(doc.id)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
              <ExternalLink size={14} /> Open in new tab
            </a>
          )}
          <a href={documentsApi.contentUrl(doc.id, true)} download={doc.fileName} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
            <Download size={14} /> Download
          </a>
        </div>
      }
    >
      <DocumentPreviewBody doc={doc} height="70vh" />
    </Modal>
  );
}
