import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, QUEUES, clickupWorkerOptions } from '../queues/queue.constants';
import { TasksService } from '../tasks/tasks.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';

@Injectable()
@Processor(QUEUES.CLICKUP_TASKS, clickupWorkerOptions())
export class TaskSyncProcessor extends WorkerHost {
  constructor(
    private readonly tasks: TasksService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
    private readonly timeEntries: TimeEntriesRepository,
  ) { super(); }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<{ taskId: string }>) {
    const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_TASKS, jobName: job.name, entityType: 'task', entityId: job.data.taskId });
    try {
      let result;
      if (job.name === JOBS.DELETE_CLICKUP_TASK) {
        // A deleted task's tracked time must go too — ClickUp removes the
        // entries with the task but emits no per-entry delete event. Delete
        // them first; the task row survives (soft delete) so the FK holds.
        await this.timeEntries.deleteByTaskId(job.data.taskId);
        result = await this.tasks.softDeleteTask(job.data.taskId);
      } else {
        result = await this.tasks.syncTask(job.data.taskId);
      }
      await this.jobLogs.finished(log.id, { tasksSynced: 1 });
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}
