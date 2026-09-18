import { IsIn } from 'class-validator';

export class SetMemberRoleDto {
  @IsIn(['LEAD', 'MEMBER']) role!: 'LEAD' | 'MEMBER';
}
