import {
  BadGatewayException, ConflictException, NotFoundException, PayloadTooLargeException, ServiceUnavailableException,
} from '@nestjs/common';
import { XeroAttachmentContentService } from './xero-attachment-content.service';
import { XeroApiError, XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';
import { MAX_ATTACHMENT_BYTES } from './xero.constants';

const PARENT = '11111111-1111-4111-8111-111111111111';
const ATT = '22222222-2222-4222-8222-222222222222';
const row = (over: Record<string, unknown> = {}) => ({
  parentId: PARENT, attachmentId: ATT, parentType: 'invoice', fileName: 'receipt.pdf', mimeType: 'application/pdf', contentLength: 1024, ...over,
});

function setup(found: unknown, file: unknown = { data: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' }) {
  const findUnique = jest.fn().mockResolvedValue(found);
  const getFile = file instanceof Error ? jest.fn().mockRejectedValue(file) : jest.fn().mockResolvedValue(file);
  const svc = new XeroAttachmentContentService({ xeroAttachment: { findUnique } } as never, { getFile } as never);
  return { svc, findUnique, getFile };
}

describe('XeroAttachmentContentService', () => {
  it('looks the attachment up by the id pair and builds the Xero path from the STORED row', async () => {
    const { svc, findUnique, getFile } = setup(row({ parentType: 'creditNote' }));
    const out = await svc.content(PARENT, ATT, false);
    expect(findUnique).toHaveBeenCalledWith({ where: { parentId_attachmentId: { parentId: PARENT, attachmentId: ATT } } });
    expect(getFile).toHaveBeenCalledWith(`/CreditNotes/${PARENT}/Attachments/${ATT}`, 'application/pdf');
    expect(out.data.toString()).toBe('%PDF-1.7');
    expect(out.inline).toBe(true);
  });

  it('404s an id pair that was never synced, without calling Xero', async () => {
    const { svc, getFile } = setup(null);
    await expect(svc.content(PARENT, ATT, false)).rejects.toBeInstanceOf(NotFoundException);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('404s a row whose parent type is unknown, without calling Xero', async () => {
    const { svc, getFile } = setup(row({ parentType: 'contact' }));
    await expect(svc.content(PARENT, ATT, false)).rejects.toBeInstanceOf(NotFoundException);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('refuses a file over the size cap before spending a Xero call', async () => {
    const { svc, getFile } = setup(row({ contentLength: MAX_ATTACHMENT_BYTES + 1 }));
    await expect(svc.content(PARENT, ATT, false)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('also refuses when the size was unknown but the bytes exceed the cap', async () => {
    const { svc } = setup(row({ contentLength: null }), { data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), contentType: null });
    await expect(svc.content(PARENT, ATT, false)).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('passes download=1 through to a forced download', async () => {
    const { svc } = setup(row());
    const out = await svc.content(PARENT, ATT, true);
    expect(out.inline).toBe(false);
    expect(out.headers['Content-Disposition']).toMatch(/^attachment;/);
  });

  it.each([
    [new XeroRateBudgetExhaustedError(100), ServiceUnavailableException],
    [new XeroReconnectRequiredError(), ConflictException],
    [new XeroApiError(404, '/x', 'gone'), NotFoundException],
    [new XeroApiError(429, '/x', 'busy'), ServiceUnavailableException],
    [new XeroApiError(null, '/x', 'maxContentLength size of 26214400 exceeded'), BadGatewayException],
    [new XeroApiError(500, '/x', 'Bearer secret-token'), BadGatewayException],
  ])('maps %s to a readable HTTP error that never echoes the raw Xero error', async (err, Http) => {
    const { svc } = setup(row(), err);
    const e = await svc.content(PARENT, ATT, false).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Http);
    expect(JSON.stringify((e as unknown as { getResponse(): unknown }).getResponse())).not.toMatch(/secret-token|Bearer|\/x/);
  });
});
