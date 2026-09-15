import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { FinanceReportsService } from './finance-reports.service';
import {
  BankTxListQueryDto, ContactListQueryDto, CreditNoteListQueryDto, InvoiceListQueryDto, PaymentListQueryDto,
} from './dto/finance-query.dto';

/** Finance data is revenue and supplier spend, so Owners and Admins only. Members get 403. */
@ApiTags('finance')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@Controller('finance')
export class FinanceReportsController {
  constructor(private readonly finance: FinanceReportsService) {}

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
