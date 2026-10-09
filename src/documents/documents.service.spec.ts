import { BadRequestException, ConflictException, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types';
import { MAX_UPLOAD_BYTES } from './document-catalog';
import { DocumentsService, type UploadedFileLike } from './documents.service';
import type { DocumentsRepository } from './documents.repository';
import { docxBytes, exeBytes, htmlBytes, jpegBytes, pdfBytes, pngBytes, svgBytes, xlsxBytes } from './testing/fixtures';
import { FakeDocumentsRepository } from './testing/fake-repository';
import { InMemoryDocumentStorage } from './testing/in-memory-storage';

const actor: AuthPrincipal = { userId: 'u1', orgId: 'org1', role: Role.OWNER, email: 'o@x.com', isMachine: false };
const file = (name: string, buffer: Buffer): UploadedFileLike => ({ originalname: name, buffer, size: buffer.length });
const dto = (over: Record<string, unknown> = {}) => ({ category: 'IDENTITY' as const, docType: 'NATIONAL_ID', ...over });

function setup() {
  const repo = new FakeDocumentsRepository();
  repo.employees.push({ id: 'e1', orgId: 'org1', fullName: 'Ayesha Khan', status: 'ACTIVE' }, { id: 'x1', orgId: 'other-org', fullName: 'Elsewhere', status: 'ACTIVE' });
  const storage = new InMemoryDocumentStorage();
  const service = new DocumentsService(repo as unknown as DocumentsRepository, storage);
  return { repo, storage, service };
}

describe('DocumentsService.upload', () => {
  it.each([
    ['pdf', pdfBytes(), 'application/pdf'],
    ['jpg', jpegBytes(), 'image/jpeg'],
    ['png', pngBytes(), 'image/png'],
    ['docx', docxBytes(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('stores a %s, recording the sniffed type, size, sha256 and key', async (ext, bytes, contentType) => {
    const { service, storage } = setup();
    const doc = await service.upload(actor, 'e1', file(`scan.${ext}`, bytes), dto());
    expect(doc).toMatchObject({ employeeId: 'e1', contentType, sizeBytes: bytes.length, version: 1, visibility: 'HR_ONLY', uploadedBy: 'u1' });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.objects.get(`employees/e1/${doc.id}`)?.body.equals(bytes)).toBe(true);
  });

  it('rejects HTML, SVG, an EXE and a non-Word zip even when named .pdf', async () => {
    const { service, storage } = setup();
    for (const bytes of [htmlBytes(), svgBytes(), exeBytes(), xlsxBytes()]) {
      await expect(service.upload(actor, 'e1', file('real.pdf', bytes), dto())).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    }
    expect(storage.objects.size).toBe(0);
  });

  it('rejects a missing file, an empty file and one over 20 MB', async () => {
    const { service } = setup();
    await expect(service.upload(actor, 'e1', undefined, dto())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(actor, 'e1', file('a.pdf', Buffer.alloc(0)), dto())).rejects.toBeInstanceOf(BadRequestException);
    const big = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await expect(service.upload(actor, 'e1', file('a.pdf', big), dto())).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('accepts a file of exactly the cap', async () => {
    const { service } = setup();
    const exact = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_UPLOAD_BYTES - pdfBytes().length)]);
    expect(exact.length).toBe(MAX_UPLOAD_BYTES);
    await expect(service.upload(actor, 'e1', file('a.pdf', exact), dto())).resolves.toBeDefined();
  });

  it('sanitises the stored name and fixes the extension to the real type', async () => {
    const { service } = setup();
    const doc = await service.upload(actor, 'e1', file('..\\..\\evil.html', pdfBytes()), dto());
    expect(doc.fileName).toBe('evil.pdf');
  });

  it('rejects a docType that is not in the category, and a bad expiry date', async () => {
    const { service } = setup();
    await expect(service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto({ docType: 'SIGNED_CONTRACT' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto({ expiresOn: '2026-02-30' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an employee that is unknown or in another org, without touching storage', async () => {
    const { service, storage } = setup();
    await expect(service.upload(actor, 'nope', file('a.pdf', pdfBytes()), dto())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.upload(actor, 'x1', file('a.pdf', pdfBytes()), dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.objects.size).toBe(0);
  });

  it('removes the object again when the row cannot be written', async () => {
    const { service, storage, repo } = setup();
    repo.failNextCreate = true;
    await expect(service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto())).rejects.toThrow('db down');
    expect(storage.objects.size).toBe(0);
  });

  it('records no uploader for a machine credential', async () => {
    const { service } = setup();
    const doc = await service.upload({ ...actor, userId: 'machine', isMachine: true }, 'e1', file('a.pdf', pdfBytes()), dto());
    expect(doc.uploadedBy).toBeNull();
  });
});

describe('DocumentsService.replace', () => {
  it('keeps the old version and chains the new one on top', async () => {
    const { service, storage } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto({ expiresOn: '2027-01-01' }));
    const v2 = await service.replace(actor, v1.id, file('b.pdf', Buffer.concat([pdfBytes(), Buffer.from('v2')])), {});
    expect(v2).toMatchObject({ version: 2, category: 'IDENTITY', docType: 'NATIONAL_ID', expiresOn: '2027-01-01' });
    expect(v2.previousVersions.map((p) => p.id)).toEqual([v1.id]);
    expect(storage.objects.has(`employees/e1/${v1.id}`)).toBe(true);
    expect(storage.objects.has(`employees/e1/${v2.id}`)).toBe(true);

    const v3 = await service.replace(actor, v2.id, file('c.png', pngBytes()), { expiresOn: '2030-05-05' });
    const list = await service.listForEmployee('org1', 'e1');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: v3.id, version: 3, expiresOn: '2030-05-05' });
    expect(list.items[0].previousVersions.map((p) => p.version)).toEqual([2, 1]);
  });

  it('refuses to replace a version that has already been replaced', async () => {
    const { service } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    await service.replace(actor, v1.id, file('b.pdf', pdfBytes()), {});
    await expect(service.replace(actor, v1.id, file('c.pdf', pdfBytes()), {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s and cleans up when a concurrent replace wins the race', async () => {
    const { service, storage, repo } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    repo.beforeReplaceCommit = () => {
      repo.docs.find((d) => d.id === v1.id)!.replacedById = 'someone-else';
    };
    await expect(service.replace(actor, v1.id, file('b.pdf', pdfBytes()), {})).rejects.toBeInstanceOf(ConflictException);
    // Only the original object remains; the loser's object was discarded.
    expect([...storage.objects.keys()]).toEqual([`employees/e1/${v1.id}`]);
  });

  it('never deletes the old object when the new upload fails', async () => {
    const { service, storage } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    storage.failNextPut = true;
    await expect(service.replace(actor, v1.id, file('b.pdf', pdfBytes()), {})).rejects.toThrow('boom');
    expect(storage.objects.has(`employees/e1/${v1.id}`)).toBe(true);
    expect((await service.listForEmployee('org1', 'e1')).items[0].id).toBe(v1.id);
  });

  it('validates the new file like an upload', async () => {
    const { service } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    await expect(service.replace(actor, v1.id, file('b.pdf', htmlBytes()), {})).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
});

describe('DocumentsService.update / remove', () => {
  it('edits metadata, validates the category/docType pair, and clears an expiry with null', async () => {
    const { service } = setup();
    const d = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto({ expiresOn: '2027-01-01' }));
    expect(await service.update('org1', d.id, { visibility: 'EVERYONE', expiresOn: null })).toMatchObject({ visibility: 'EVERYONE', expiresOn: null });
    expect(await service.update('org1', d.id, { docType: 'PASSPORT' })).toMatchObject({ docType: 'PASSPORT' });
    await expect(service.update('org1', d.id, { category: 'EXIT' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not edit or delete an older version', async () => {
    const { service } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    await service.replace(actor, v1.id, file('b.pdf', pdfBytes()), {});
    await expect(service.update('org1', v1.id, { visibility: 'EVERYONE' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove('org1', v1.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes the whole chain, keeps every object, and then 404s', async () => {
    const { service, storage, repo } = setup();
    const v1 = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    const v2 = await service.replace(actor, v1.id, file('b.pdf', pdfBytes()), {});
    await service.remove('org1', v2.id);
    expect(repo.docs.every((d) => d.deletedAt)).toBe(true);
    expect(storage.objects.size).toBe(2); // the objects are kept
    await expect(service.content('org1', v1.id, false)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.content('org1', v2.id, false)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.listForEmployee('org1', 'e1')).items).toEqual([]);
  });

  it("404s another org's document", async () => {
    const { service } = setup();
    const d = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    await expect(service.remove('other-org', d.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService.content headers', () => {
  it('serves a PDF inline with the PDF-safe CSP and the stored length', async () => {
    const { service } = setup();
    const d = await service.upload(actor, 'e1', file('Offer letter.pdf', pdfBytes()), dto());
    const { headers } = await service.content('org1', d.id, false);
    expect(headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'Cache-Control': 'private, no-store',
      'Content-Length': String(pdfBytes().length),
    });
    expect(headers['Content-Disposition']).toMatch(/^inline; filename="Offer letter.pdf"; filename\*=UTF-8''Offer%20letter\.pdf$/);
  });

  it('serves images inline, but download=1 and DOCX always download', async () => {
    const { service } = setup();
    const img = await service.upload(actor, 'e1', file('p.png', pngBytes()), dto());
    expect((await service.content('org1', img.id, false)).headers['Content-Disposition']).toMatch(/^inline;/);
    const forced = (await service.content('org1', img.id, true)).headers;
    expect(forced['Content-Disposition']).toMatch(/^attachment;/);
    expect(forced['Content-Security-Policy']).toBe("sandbox; default-src 'none'");
    const docx = await service.upload(actor, 'e1', file('c.docx', docxBytes()), dto({ category: 'EMPLOYMENT', docType: 'SIGNED_CONTRACT' }));
    const h = (await service.content('org1', docx.id, false)).headers;
    expect(h['Content-Disposition']).toMatch(/^attachment;/);
    expect(h['Content-Type']).toBe('application/octet-stream');
  });

  it('streams the stored bytes back', async () => {
    const { service } = setup();
    const d = await service.upload(actor, 'e1', file('a.pdf', pdfBytes()), dto());
    const { stream } = await service.content('org1', d.id, false);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).equals(pdfBytes())).toBe(true);
  });
});

describe('DocumentsService lists', () => {
  it("returns an employee's checklist and flags expiry", async () => {
    const { service } = setup();
    const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    await service.upload(actor, 'e1', file('nid.pdf', pdfBytes()), dto({ expiresOn: soon }));
    const res = await service.listForEmployee('org1', 'e1');
    expect(res.items[0].expiry.status).toBe('expiring');
    expect(res.checklist.map((c) => [c.key, c.satisfied])).toEqual([
      ['IDENTITY_PROOF', true],
      ['SIGNED_CONTRACT', false],
      ['EDUCATION_CERTIFICATE', false],
      ['EMERGENCY_CONTACT_FORM', false],
    ]);
    expect(res.docTypes.IDENTITY.map((t) => t.key)).toContain('NATIONAL_ID');
  });

  it('builds the company list with counts and paginates', async () => {
    const { service } = setup();
    await service.upload(actor, 'e1', file('nid.pdf', pdfBytes()), dto({ expiresOn: '2020-01-01' }));
    await service.upload(actor, 'e1', file('b.pdf', pdfBytes()), dto({ docType: 'PASSPORT' }));
    const all = await service.listCompany('org1', {});
    expect(all.counts).toMatchObject({ total: 2, expired: 1, expiring: 0, missing: 3, missingEmployees: 1 });
    expect(all.total).toBe(2);
    expect((await service.listCompany('org1', { limit: 1, page: 2 })).rows).toHaveLength(1);
    expect((await service.listCompany('org1', { status: 'missing' })).rows).toHaveLength(3);
    expect((await service.listCompany('org1', { status: 'expired' })).rows).toHaveLength(1);
  });
});

describe('DocumentsService.storeGenerated (exit letters)', () => {
  const letter = { category: 'EXIT' as const, docType: 'EXPERIENCE_LETTER', fileName: 'Experience letter - Ayesha Khan.pdf' };

  it('files the first letter as an EXIT document, version 1', async () => {
    const { service, storage } = setup();
    const doc = await service.storeGenerated(actor, 'e1', { ...letter, buffer: pdfBytes() });
    expect(doc).toMatchObject({ employeeId: 'e1', category: 'EXIT', docType: 'EXPERIENCE_LETTER', version: 1, contentType: 'application/pdf' });
    expect(storage.objects.size).toBe(1);
  });

  it('regenerating replaces the current one with a new version instead of adding a second', async () => {
    const { service } = setup();
    const first = await service.storeGenerated(actor, 'e1', { ...letter, buffer: pdfBytes() });
    const second = await service.storeGenerated(actor, 'e1', { ...letter, buffer: Buffer.concat([pdfBytes(), Buffer.from('\n% v2')]) });
    expect(second.version).toBe(2);
    expect(second.previousVersions.map((p) => p.id)).toEqual([first.id]);
    const current = await service.currentInCategory('org1', 'e1', 'EXIT');
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(second.id);
  });

  it('keeps the two letter types apart and refuses another org employee', async () => {
    const { service } = setup();
    await service.storeGenerated(actor, 'e1', { ...letter, buffer: pdfBytes() });
    await service.storeGenerated(actor, 'e1', { ...letter, docType: 'RELEASE_LETTER', fileName: 'Release letter.pdf', buffer: pdfBytes() });
    expect(await service.currentInCategory('org1', 'e1', 'EXIT')).toHaveLength(2);
    await expect(service.storeGenerated(actor, 'x1', { ...letter, buffer: pdfBytes() })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService: an exited employee is read-only', () => {
  const MESSAGE = 'This employee has exited; their record is read-only.';
  const letter = { category: 'EXIT' as const, docType: 'EXPERIENCE_LETTER', fileName: 'Experience letter.pdf' };

  /** One document uploaded while the employee was still active, then the employee exits. */
  async function exitedWithDocument() {
    const ctx = setup();
    const doc = await ctx.service.upload(actor, 'e1', file('id.pdf', pdfBytes()), dto());
    ctx.repo.employees.find((e) => e.id === 'e1')!.status = 'EXITED';
    return { ...ctx, doc };
  }

  it('rejects upload, replace, patch and delete with 409 and changes nothing', async () => {
    const { service, repo, storage, doc } = await exitedWithDocument();
    const objects = storage.objects.size;
    for (const attempt of [
      () => service.upload(actor, 'e1', file('b.pdf', pdfBytes()), dto()),
      () => service.replace(actor, doc.id, file('b.pdf', pdfBytes()), {}),
      () => service.update('org1', doc.id, { visibility: 'EMPLOYEE_VISIBLE' } as never),
      () => service.remove('org1', doc.id),
    ]) {
      const err = await attempt().catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(MESSAGE);
    }
    expect(storage.objects.size).toBe(objects);
    expect(repo.docs).toHaveLength(1);
    expect(repo.docs[0].deletedAt).toBeNull();
  });

  it('still lets people read: list, company report and content', async () => {
    const { service, doc } = await exitedWithDocument();
    expect((await service.listForEmployee('org1', 'e1')).items).toHaveLength(1);
    await expect(service.content('org1', doc.id, false)).resolves.toBeDefined();
    await expect(service.currentInCategory('org1', 'e1', 'IDENTITY')).resolves.toHaveLength(1);
  });

  it('storeGenerated still files exit letters, first time and as a new version', async () => {
    const { service, repo } = await exitedWithDocument();
    const first = await service.storeGenerated(actor, 'e1', { ...letter, buffer: pdfBytes() });
    expect(first.version).toBe(1);
    const second = await service.storeGenerated(actor, 'e1', { ...letter, buffer: Buffer.concat([pdfBytes(), Buffer.from('\n% v2')]) });
    expect(second.version).toBe(2);
    expect(repo.docs.filter((d) => d.docType === 'EXPERIENCE_LETTER')).toHaveLength(2);
  });
});
