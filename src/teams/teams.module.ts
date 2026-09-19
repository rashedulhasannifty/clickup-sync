import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { UserRepository } from '../auth/user.repository';
import { ClientsModule } from '../clients/clients.module';
import { DatabaseModule } from '../database/database.module';
import { MyTeamsController } from './my-teams.controller';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

@Module({
  // AuditLogInterceptor/AuditLogRepository come from AdminModule (see its exports).
  // UserRepository isn't exported by AuthModule, so it's provided again here — it's
  // a thin, stateless PrismaService wrapper, safe to instantiate per-module.
  imports: [DatabaseModule, ClientsModule, AdminModule],
  controllers: [TeamsController, MyTeamsController],
  providers: [TeamsRepository, TeamsService, UserRepository],
  // TeamsRepository is exported so AuthModule can validate an invitation's team
  // ids and add accepted users to their teams (InvitationService).
  exports: [TeamsRepository],
})
export class TeamsModule {}
