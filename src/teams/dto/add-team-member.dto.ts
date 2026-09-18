import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Shared by both add-member routes. `POST /teams/:id/members` (Owner/Admin) supplies
 * `role`; `POST /my-teams/:id/members` (lead) omits it — TeamsService.leadAddMember
 * always adds as MEMBER regardless of what's sent here.
 */
export class AddTeamMemberDto {
  @IsString() userId!: string;
  @IsOptional() @IsIn(['LEAD', 'MEMBER']) role?: 'LEAD' | 'MEMBER';
}
