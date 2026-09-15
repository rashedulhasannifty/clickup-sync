import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvoiceListQueryDto } from './finance-query.dto';

const statusErrors = async (status: string) =>
  (await validate(plainToInstance(InvoiceListQueryDto, { type: 'ACCREC', status }))).map((e) => e.property);

describe('InvoiceListQueryDto.status', () => {
  it.each(['DRAFT', 'SUBMITTED', 'AUTHORISED', 'overdue', 'PAID', 'VOIDED', 'unpaid'])('accepts %s', async (status) => {
    expect(await statusErrors(status)).toEqual([]);
  });

  it.each(['DELETED', 'UNPAID', 'all'])('rejects %s', async (status) => {
    expect(await statusErrors(status)).toEqual(['status']);
  });
});
