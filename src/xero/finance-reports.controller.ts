import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { FinanceReportsService } from './finance-reports.service';
import { XeroAttachmentContentService } from './xero-attachment-content.service';
import {
  BankTxListQueryDto, ContactListQueryDto, CreditNoteListQueryDto, InvoiceListQueryDto, PaymentListQueryDto,
} from './dto/finance-query.dto';

/** Finance data is revenue and supplier spend, so Owners and Admins only. Members get 403. */
@ApiTags('finance')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@Controller('finance')
export class FinanceReportsController {
  constructor(
    private readonly finance: FinanceReportsService,
    private readonly attachments: XeroAttachmentContentService,
  ) {}

  /**
   * An attachment's file, fetched live from Xero. PDFs and raster images are served inline for the
   * in-app viewer; everything else — and anything with `download=1` — is a download. Headers are
   * set per file type (see xero-attachment-delivery.ts); do not replace them with a global policy.
   */
  @Get('attachments/:parentId/:attachmentId/content')
  @ApiOperation({ summary: "Stream an attachment's file from Xero (one Xero API call per request)" })
  async attachmentContent(
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.attachments.content(parentId, attachmentId, download === '1' || download === 'true');
    res.set(file.headers);
    return new StreamableFile(file.data);
  }

  @Get('summary') @ApiOperation({ summary: 'KPIs, aged receivables, top overdue, 6-month money in/out' })
  summary() { return this.finance.summary(); }

  @Get('contacts') listContacts(@Query() q: ContactListQueryDto) { return this.finance.listContacts(q); }
  @Get('contacts/:id') contact(@Param('id', ParseUUIDPipe) id: string) { return this.finance.contactDetail(id); }
  @Get('contacts/:id/activity') activity(@Param('id', ParseUUIDPipe) id: string) { return this.finance.contactActivity(id); }

  @Get('invoices') listInvoices(@Query() q: InvoiceListQueryDto) { return this.finance.listInvoices(q); }
  @Get('invoices/:id') invoice(@Param('id', ParseUUIDPipe) id: string) { return this.finance.invoiceDetail(id); }

  @Get('bank-transactions') listBank(@Query() q: BankTxListQueryDto) { return this.finance.listBankTransactions(q); }
  @Get('bank-transactions/:id') bankTx(@Param('id', ParseUUIDPipe) id: string) { return this.finance.bankTransactionDetail(id); }

  @Get('credit-notes') listCreditNotes(@Query() q: CreditNoteListQueryDto) { return this.finance.listCreditNotes(q); }
  @Get('credit-notes/:id') creditNote(@Param('id', ParseUUIDPipe) id: string) { return this.finance.creditNoteDetail(id); }

  @Get('payments') listPayments(@Query() q: PaymentListQueryDto) { return this.finance.listPayments(q); }
}
