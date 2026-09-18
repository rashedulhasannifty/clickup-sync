import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class SetTeamClientsDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) optionIds!: string[];
  @IsOptional() @IsBoolean() move?: boolean;
}
