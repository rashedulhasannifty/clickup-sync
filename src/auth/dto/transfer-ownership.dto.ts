import { IsString } from 'class-validator';

export class TransferOwnershipDto {
  @IsString() targetUserId!: string;
}
