import { IsEmail, IsIn, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsIn(['ADMIN', 'MEMBER']) role!: 'ADMIN' | 'MEMBER';
}
