import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { STATUS_BUCKETS, type StatusBucket } from '../finance-math';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

export class FinancePageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

export class FinanceRangeDto extends FinancePageDto {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsUUID() contactId?: string;
}

export class ContactListQueryDto extends FinancePageDto {
  @IsOptional() @IsIn(['customer', 'supplier']) role?: 'customer' | 'supplier';
  @IsOptional() @Transform(toBool) @IsBoolean() archived?: boolean;
  @IsOptional() @IsIn(['name', 'owed', 'overdue', 'owing', 'lastActivity']) sort?: 'name' | 'owed' | 'overdue' | 'owing' | 'lastActivity';
}

export class InvoiceListQueryDto extends FinanceRangeDto {
  @IsIn(['ACCREC', 'ACCPAY']) type!: 'ACCREC' | 'ACCPAY';
  @IsOptional() @IsIn(STATUS_BUCKETS) status?: StatusBucket;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['date', 'dueDate', 'number', 'contactName', 'total', 'amountDue']) sort?: string;
}

export class BankTxListQueryDto extends FinanceRangeDto {
  @IsOptional() @IsIn(['SPEND', 'RECEIVE']) type?: 'SPEND' | 'RECEIVE';
  @IsOptional() @Transform(toBool) @IsBoolean() reconciled?: boolean;
  @IsOptional() @IsIn(['date', 'total', 'contactName']) sort?: string;
}

export class CreditNoteListQueryDto extends FinanceRangeDto {
  @IsOptional() @IsIn(['date', 'number', 'total']) sort?: string;
}

export class PaymentListQueryDto extends FinanceRangeDto {
  @IsOptional() @IsIn(['in', 'out']) direction?: 'in' | 'out';
  @IsOptional() @IsIn(['date', 'amount']) sort?: string;
}
