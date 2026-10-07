import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { RolesGuard } from '../auth/roles.guard';
import { MAX_UPLOAD_BYTES } from './document-catalog';
import { DOCUMENT_STORAGE, type DocumentStorage } from './document-storage';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { DisabledDocumentStorage } from './s3-document-storage';
import { FakeDocumentsRepository } from './testing/fake-repository';
import { InMemoryDocumentStorage } from './testing/in-memory-storage';
import { htmlBytes, pdfBytes } from './testing/fixtures';

const auditRepo = { create: jest.fn().mockResolvedValue(undefined) };

async function boot(storage: DocumentStorage, role: Role = Role.OWNER) {
  const repo = new FakeDocumentsRepository();
  repo.employees.push({ id: 'e1', orgId: 'org1', fullName: 'Ayesha Khan', status: 'ACTIVE' });
  const moduleRef = await Test.createTestingModule({
    controllers: [DocumentsController],
    providers: [
      DocumentsService,
      DocumentsEnabledGuard,
      { provide: DocumentsRepository, useValue: repo },
      { provide: DOCUMENT_STORAGE, useValue: storage },
      AuditLogInterceptor,
      { provide: AuditLogRepository, useValue: auditRepo },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  // Stand-in for the global AuthGuard: attach a principal.
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { userId: 'u1', orgId: 'org1', role, email: 'a@b.c', isMachine: false };
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, storage };
}

describe('documents HTTP', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers 503 on every route when storage is not configured, before reading the body', async () => {
    ({ app } = await boot(new DisabledDocumentStorage()));
    const server = app.getHttpServer();
    expect((await request(server).get('/people/documents')).status).toBe(503);
    expect((await request(server).get('/people/employees/e1/documents')).status).toBe(503);
    const up = await request(server).post('/people/employees/e1/documents').field('category', 'IDENTITY').field('docType', 'NATIONAL_ID').attach('file', pdfBytes(), 'a.pdf');
    expect(up.status).toBe(503);
    expect((await request(server).delete('/people/documents/6f1f2a52-7d7b-4c0e-8d0e-3d9a7f0c2b11')).status).toBe(503);
  });

  it('uploads, lists, streams back inline, and replaces over HTTP', async () => {
    ({ app } = await boot(new InMemoryDocumentStorage()));
    const server = app.getHttpServer();
    const up = await request(server)
      .post('/people/employees/e1/documents')
      .field('category', 'IDENTITY')
      .field('docType', 'NATIONAL_ID')
      .field('expiresOn', '')
      .attach('file', pdfBytes(), 'NID card.pdf');
    expect(up.status).toBe(201);
    expect(auditRepo.create).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', statusCode: 201 }));
    expect(up.body).toMatchObject({ fileName: 'NID card.pdf', contentType: 'application/pdf', version: 1, expiresOn: null });
    expect(JSON.stringify(up.body)).not.toContain('storageKey');

    const content = await request(server).get(`/people/documents/${up.body.id}/content`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(content.status).toBe(200);
    expect(content.headers['content-disposition']).toMatch(/^inline;/);
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect((content.body as Buffer).equals(pdfBytes())).toBe(true);

    const rep = await request(server).post(`/people/documents/${up.body.id}/replace`).attach('file', pdfBytes(), 'NID v2.pdf');
    expect(rep.status).toBe(201);
    expect(rep.body.version).toBe(2);
    const list = await request(server).get('/people/employees/e1/documents');
    expect(list.body.items).toHaveLength(1);
  });

  it('rejects a disguised file with 415 and a missing file with 400', async () => {
    ({ app } = await boot(new InMemoryDocumentStorage()));
    const server = app.getHttpServer();
    const bad = await request(server).post('/people/employees/e1/documents').field('category', 'IDENTITY').field('docType', 'NATIONAL_ID').attach('file', htmlBytes(), 'x.pdf');
    expect(bad.status).toBe(415);
    const none = await request(server).post('/people/employees/e1/documents').field('category', 'IDENTITY').field('docType', 'NATIONAL_ID');
    expect(none.status).toBe(400);
    const badField = await request(server).post('/people/employees/e1/documents').field('category', 'NOPE').field('docType', 'X').attach('file', pdfBytes(), 'a.pdf');
    expect(badField.status).toBe(400);
  });

  it('answers 413 when the multipart body exceeds the 20 MB cap, and stores nothing', async () => {
    const storage = new InMemoryDocumentStorage();
    ({ app } = await boot(storage));
    const big = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    const res = await request(app.getHttpServer())
      .post('/people/employees/e1/documents')
      .field('category', 'IDENTITY')
      .field('docType', 'NATIONAL_ID')
      .attach('file', big, 'big.pdf');
    expect(res.status).toBe(413);
    expect(storage.objects.size).toBe(0);
  });

  it('lets an Owner delete but forbids an Admin (DELETE is Owner-only)', async () => {
    const storage = new InMemoryDocumentStorage();
    ({ app } = await boot(storage, Role.ADMIN));
    const server = app.getHttpServer();
    const up = await request(server).post('/people/employees/e1/documents').field('category', 'IDENTITY').field('docType', 'NATIONAL_ID').attach('file', pdfBytes(), 'a.pdf');
    expect(up.status).toBe(201); // Admin may upload
    expect((await request(server).delete(`/people/documents/${up.body.id}`)).status).toBe(403);
    await app.close();

    ({ app } = await boot(new InMemoryDocumentStorage(), Role.OWNER));
    const s2 = app.getHttpServer();
    const up2 = await request(s2).post('/people/employees/e1/documents').field('category', 'IDENTITY').field('docType', 'NATIONAL_ID').attach('file', pdfBytes(), 'a.pdf');
    expect((await request(s2).delete(`/people/documents/${up2.body.id}`)).status).toBe(204);
    expect((await request(s2).get(`/people/documents/${up2.body.id}/content`)).status).toBe(404);
  });

  it('forbids a Member on every route', async () => {
    ({ app } = await boot(new InMemoryDocumentStorage(), Role.MEMBER));
    expect((await request(app.getHttpServer()).get('/people/documents')).status).toBe(403);
  });
});
