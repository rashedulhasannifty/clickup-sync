import { IsOptional, IsString } from 'class-validator';

export class SetClickupUserDto {
  // @IsOptional() lets `null` through — that's how a caller clears the link.
  @IsOptional() @IsString() clickupUserId?: string | null;
}
