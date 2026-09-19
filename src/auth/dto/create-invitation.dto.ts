import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class InviteTeamDto {
  @IsString() teamId!: string;
  @IsIn(['LEAD', 'MEMBER']) role!: 'LEAD' | 'MEMBER';
}

export class CreateInvitationDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsIn(['ADMIN', 'MEMBER']) role!: 'ADMIN' | 'MEMBER';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InviteTeamDto) teams?: InviteTeamDto[];
  // @IsOptional() lets `null` through: undefined means "auto-match by email",
  // null means "no link" — see InvitationService.create.
  @IsOptional() @IsString() clickupUserId?: string | null;
}
