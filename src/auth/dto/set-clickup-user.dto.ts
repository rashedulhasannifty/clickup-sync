import { IsDefined, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class SetClickupUserDto {
  // The field must be present in the body — `{}` is invalid (it would otherwise
  // silently clear the link, indistinguishable from an explicit `null`).
  // `null` clears the link explicitly; anything else must be a non-empty string
  // — an empty string would otherwise be stored as an identity on the
  // @unique `clickupUserId` column. ValidateIf skips the rest of these checks
  // (but not itself) only when the value is exactly `null`.
  @ValidateIf((o) => o.clickupUserId !== null)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  clickupUserId!: string | null;
}
