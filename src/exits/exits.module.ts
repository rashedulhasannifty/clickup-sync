import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { DocumentsModule } from '../documents/documents.module';
import { PeopleModule } from '../people/people.module';
import { ExitsController } from './exits.controller';
import { ExitsRepository } from './exits.repository';
import { ExitsService } from './exits.service';

@Module({
  // AuditLogInterceptor/AuditLogRepository come from AdminModule (see its exports).
  // AuthModule: UsersService disables the leaver's login. PeopleModule: EmployeesService writes
  // the employment events. DocumentsModule: DocumentsService stores the generated letters.
  imports: [DatabaseModule, AdminModule, AuthModule, PeopleModule, DocumentsModule],
  controllers: [ExitsController],
  providers: [ExitsRepository, ExitsService],
})
export class ExitsModule {}
