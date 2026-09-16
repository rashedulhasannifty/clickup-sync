import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileWarning } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Tabs } from '../ui/Tabs';
import { attachmentApi, type AttachmentItem } from '../../api/finance';
import {
  cellText, errorMessageFromBytes, parseCsv, PREVIEW_ROW_LIMIT, viewerKind, type TablePreview,
} from '../../lib/attachmentPreview';

type Sheet = TablePreview & { name: string };

async function loadSheets(a: AttachmentItem, kind: 'csv' | 'xlsx'): Promise<Sheet[]> {
  const buf = await attachmentApi.bytes(a);
  if (kind === 'csv') return [{ name: a.fileName, ...parseCsv(new TextDecoder().decode(buf)) }];
  // Lazy: exceljs is ~900 KB and only needed when someone opens a spreadsheet.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    let total = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      total += 1;
      if (rows.length >= PREVIEW_ROW_LIMIT) return;
      // row.values is 1-based: index 0 is always empty.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(cellText));
    });
    return { name: ws.name, rows, total };
  });
}

function readableError(e: unknown): string {
  const res = (e as { response?: { status?: number; data?: unknown } })?.response;
  return errorMessageFromBytes(res?.data) ?? "Couldn't load this file. Try Download instead.";
}

function PreviewTable({ sheet }: { sheet: Sheet }) {
  if (!sheet.rows.length) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>This sheet is empty.</p>;
  const width = Math.max(...sheet.rows.map((r) => r.length));
  const [head, ...body] = sheet.rows;
  const cell = { padding: '6px 10px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' as const, textAlign: 'left' as const };
  return (
    <>
      <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid var(--border-soft)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', minWidth: '100%' }}>
          <thead>
            <tr>
              {Array.from({ length: width }, (_, i) => (
                <th key={i} style={{ ...cell, position: 'sticky', top: 0, background: 'var(--surface)', fontWeight: 600 }}>{head[i] ?? ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{Array.from({ length: width }, (_, i) => <td key={i} style={cell}>{r[i] ?? ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.total > sheet.rows.length && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Showing {sheet.rows.length.toLocaleString()} of {sheet.total.toLocaleString()} rows. Download the file for the rest.
        </p>
      )}
    </>
  );
}

function TableView({ item, kind }: { item: AttachmentItem; kind: 'csv' | 'xlsx' }) {
  const [active, setActive] = useState(0);
  const q = useQuery({
    queryKey: ['finance', 'attachment-content', item.parentId, item.id],
    queryFn: () => loadSheets(item, kind),
    // Every fetch is a Xero API call: don't refetch on focus or retry into a limit.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });
  if (q.isLoading) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading from Xero…</p>;
  if (q.isError || !q.data) return <Problem text={readableError(q.error)} />;
  const sheets = q.data;
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sheets.length > 1 && (
        <Tabs variant="underline" ariaLabel="Sheets" value={String(active)} onChange={(v) => setActive(Number(v))}
          items={sheets.map((s, i) => ({ value: String(i), label: s.name }))} />
      )}
      {sheet ? <PreviewTable sheet={sheet} /> : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>This workbook has no sheets.</p>}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
      <FileWarning size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{text}</span>
    </div>
  );
}

export function AttachmentViewer({ item, onClose }: { item: AttachmentItem | null; onClose: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!item) return null;
  const kind = viewerKind(item.fileName, item.mimeType);
  const url = attachmentApi.url(item);

  let body;
  if (kind === 'pdf') {
    // No `sandbox` attribute: Chromium refuses to run its PDF viewer in a sandboxed frame and shows
    // a blank box. It is safe unsandboxed because the server only ever serves allowlisted PDFs and
    // raster images inline, with nosniff (see src/xero/xero-attachment-delivery.ts).
    body = <iframe title={item.fileName} src={url} style={{ width: '100%', height: '70vh', border: 0, borderRadius: 8, background: 'var(--surface)' }} />;
  } else if (kind === 'image') {
    body = imageFailed
      ? <Problem text="Couldn't load this image from Xero. Try Download instead." />
      : <img src={url} alt={item.fileName} onError={() => setImageFailed(true)} style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', margin: '0 auto', borderRadius: 8 }} />;
  } else if (kind === 'csv' || kind === 'xlsx') {
    body = <TableView item={item} kind={kind} />;
  } else if (kind === 'xls') {
    body = <Problem text="Old-format Excel files (.xls) can't be previewed here. Download it and open it in Excel." />;
  } else {
    body = <Problem text="This file type can't be previewed here. Download it to open it on your computer." />;
  }

  return (
    <Modal
      open
      onClose={() => { setImageFailed(false); onClose(); }}
      width={1000}
      title={item.fileName}
      subtitle="Fetched from Xero. Nothing in Xero is changed."
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <a href={attachmentApi.url(item, true)} download={item.fileName}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
            <Download size={14} /> Download
          </a>
        </div>
      }
    >
      {body}
    </Modal>
  );
}
