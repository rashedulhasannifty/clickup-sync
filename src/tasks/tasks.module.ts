import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { ListsModule } from '../lists/lists.module';
import { TaskAssigneeChargeabilityRepository } from './task-assignee-chargeability.repository';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

@Module({ imports: [ClickupModule, ListsModule], providers: [TaskAssigneeChargeabilityRepository, TasksRepository, TasksService], exports: [TaskAssigneeChargeabilityRepository, TasksRepository, TasksService] })
export class TasksModule {}
