import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  // Same policy as AcceptInvitationDto — a reset must not be a way to set a
  // weaker password than signup would have allowed.
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
}
