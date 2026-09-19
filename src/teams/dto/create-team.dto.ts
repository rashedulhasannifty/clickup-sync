import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class CreateTeamDto {
  @IsString() @MaxLength(80) name!: string;
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) optionIds!: string[];
}
