import {
  BadGatewayException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException, ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { XeroClient } from './xero.client';
import { XeroApiError, XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';
import { ATTACHMENT_PARENTS, MAX_ATTACHMENT_BYTES, type AttachmentParentType } from './xero.constants';
import { attachmentDelivery, safeContentType, type AttachmentDelivery } from './xero-attachment-delivery';

export interface AttachmentContent extends AttachmentDelivery {
  data: Buffer;
}

const TOO_LARGE = 'This file is larger than 25 MB. Open it in Xero instead.';

/**
 * Fetches an attachment's bytes from Xero on demand. Nothing is stored: each open is one Xero call.
 *
 * The Xero path is built ONLY from the stored row. The request supplies an id pair, and a pair we
 * haven't synced is a 404 — so this can never be steered at an arbitrary Xero record or path.
 */
@Injectable()
export class XeroAttachmentContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: XeroClient,
  ) {}

  async content(parentId: string, attachmentId: string, forceDownload: boolean): Promise<AttachmentContent> {
    const row = await this.prisma.xeroAttachment.findUnique({ where: { parentId_attachmentId: { parentId, attachmentId } } });
    if (!row) throw new NotFoundException('Attachment not found.');
    const parentPath = ATTACHMENT_PARENTS[row.parentType as AttachmentParentType];
    if (!parentPath) throw new NotFoundException('Attachment not found.');
    if (row.contentLength != null && row.contentLength > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException(TOO_LARGE);

    const path = `${parentPath}/${row.parentId}/Attachments/${row.attachmentId}`;
    let data: Buffer;
    try {
      ({ data } = await this.client.getFile(path, safeContentType(row.fileName, row.mimeType)));
    } catch (e) {
      throw this.toHttpError(e);
    }
    if (data.length > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException(TOO_LARGE);
    return { data, ...attachmentDelivery(row.fileName, row.mimeType, forceDownload) };
  }

  private toHttpError(e: unknown): Error {
    if (e instanceof XeroRateBudgetExhaustedError) {
      return new ServiceUnavailableException("Xero's daily API limit is nearly used up. Try again later, or open the file in Xero.");
    }
    if (e instanceof XeroReconnectRequiredError) {
      return new ConflictException('Xero needs reconnecting in Settings → Xero before files can be opened.');
    }
    if (e instanceof XeroApiError && e.status === 404) return new NotFoundException('Xero no longer has this file. It may have been removed.');
    if (e instanceof XeroApiError && e.status === 429) return new ServiceUnavailableException('Xero is busy. Try again in a minute.');
    // Network errors, axios maxContentLength overflow, 5xx: never echo the raw error (it can carry the bearer token).
    return new BadGatewayException("Xero didn't return the file. Try again in a minute.");
  }
}
