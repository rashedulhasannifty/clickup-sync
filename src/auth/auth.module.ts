import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { MailerModule } from './mailer.module';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { SessionCleanupService } from './session-cleanup.service';
import { AuthService } from './auth.service';
import { InvitationService } from './invitation.service';
import { UsersService } from './users.service';
import { OrgRepository } from './org.repository';
import { UserRepository } from './user.repository';
import { SessionRepository } from './session.repository';
import { InvitationRepository } from './invitation.repository';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { AuthController } from './auth.controller';
import { InvitationController } from './invitation.controller';
import { UsersController } from './users.controller';
import { isWorker } from '../config/role';
import { AccessModule } from '../access/access.module';
import { AccessScopeGuard } from '../access/access-scope.guard';
import { TeamsModule } from '../teams/teams.module';
import { ClickupModule } from '../clickup/clickup.module';

@Module({
  // TeamsModule: InvitationService validates an invite's team ids and applies
  // TeamMember rows on accept (TeamsRepository). ClickupModule: InvitationService
  // auto-matches an invite's clickupUserId by email (WorkspaceMembersService).
  // Neither imports AuthModule, so there's no cycle.
  imports: [ConfigModule, MailerModule, AdminModule, AccessModule, TeamsModule, ClickupModule],
  controllers: [AuthController, InvitationController, UsersController],
  providers: [
    PasswordService, TokenService, PermissionsService, SessionService,
    AuthService, InvitationService, UsersService,
    OrgRepository, UserRepository, SessionRepository, InvitationRepository,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Registration order matters: Nest runs APP_GUARDs in the order they're
    // provided, so this must come after RolesGuard (it depends on req.user,
    // attached by AuthGuard, and only makes sense once RBAC has already passed).
    { provide: APP_GUARD, useClass: AccessScopeGuard },
    ...(isWorker() ? [SessionCleanupService] : []),
  ],
  // AccessScopeService/AccessScopeGuard are NOT re-exported here: AuthModule
  // doesn't own them (AccessModule does), and re-exporting an imported
  // module's provider by bare token is a Nest error ("cannot export a
  // provider that is not part of the currently processed module"). They
  // don't need to be — AccessModule is @Global(), so AuthController (and
  // every other module) can inject AccessScopeService directly once
  // AccessModule is anywhere in the graph (it's imported here and in
  // app.module.ts).
  exports: [SessionService, OrgRepository],
})
export class AuthModule {}
