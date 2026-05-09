import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
@Processor(QUEUES.CLICKUP_TASKS)
export class TaskSyncProcessor extends WorkerHost {
  constructor(private readonly tasks: TasksService) { super(); }
  async process(job: Job<{ taskId: string }>) {
    if (job.name === JOBS.DELETE_CLICKUP_TASK) return this.tasks.softDeleteTask(job.data.taskId);
    return this.tasks.syncTask(job.data.taskId);
  }
}
