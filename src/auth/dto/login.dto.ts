import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsString() @MaxLength(200) password!: string;
}
