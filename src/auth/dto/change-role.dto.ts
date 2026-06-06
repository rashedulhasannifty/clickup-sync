import { IsIn } from 'class-validator';

export class ChangeRoleDto {
  @IsIn(['OWNER', 'ADMIN', 'MEMBER']) role!: 'OWNER' | 'ADMIN' | 'MEMBER';
}
