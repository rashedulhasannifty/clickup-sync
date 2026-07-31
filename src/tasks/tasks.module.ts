import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { ListsModule } from '../lists/lists.module';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

@Module({ imports: [ClickupModule, ListsModule], providers: [TasksRepository, TasksService], exports: [TasksRepository, TasksService] })
export class TasksModule {}
