import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail() @MaxLength(256) email!: string;
  @IsString() @MinLength(10) @MaxLength(200) password!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(120) orgName!: string;
}
