import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

@Module({ imports: [ClickupModule], providers: [TasksRepository, TasksService], exports: [TasksRepository, TasksService] })
export class TasksModule {}
