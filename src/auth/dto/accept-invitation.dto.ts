import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
}
