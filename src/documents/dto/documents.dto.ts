import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES, type DocumentCategoryName, type DocumentVisibilityName } from '../document-catalog';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Multipart sends an untouched optional field as ''; treat that as "not provided". */
const blankToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class UploadDocumentDto {
  @IsIn(DOCUMENT_CATEGORIES) category!: DocumentCategoryName;
  @IsString() @MaxLength(60) docType!: string;
  @Transform(blankToUndefined) @IsOptional() @Matches(ISO_DATE, { message: 'expiresOn must be YYYY-MM-DD' }) expiresOn?: string;
  @Transform(blankToUndefined) @IsOptional() @IsIn(DOCUMENT_VISIBILITIES) visibility?: DocumentVisibilityName;
}

export class ReplaceDocumentDto {
  /** Omitted = keep the previous version's expiry. */
  @Transform(blankToUndefined) @IsOptional() @Matches(ISO_DATE, { message: 'expiresOn must be YYYY-MM-DD' }) expiresOn?: string;
}

export class UpdateDocumentDto {
  @IsOptional() @IsIn(DOCUMENT_CATEGORIES) category?: DocumentCategoryName;
  @IsOptional() @IsString() @MaxLength(60) docType?: string;
  /** `null` clears the expiry. */
  @IsOptional() @Matches(ISO_DATE, { message: 'expiresOn must be YYYY-MM-DD' }) expiresOn?: string | null;
  @IsOptional() @IsIn(DOCUMENT_VISIBILITIES) visibility?: DocumentVisibilityName;
}

export class CompanyDocumentsQueryDto {
  @IsOptional() @IsIn(['expiring', 'expired', 'missing']) status?: 'expiring' | 'expired' | 'missing';
  @IsOptional() @IsIn(DOCUMENT_CATEGORIES) category?: DocumentCategoryName;
  @IsOptional() @IsString() @MaxLength(60) employeeId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(200) limit?: number;
}
