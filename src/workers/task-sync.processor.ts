import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, QUEUES, clickupWorkerOptions } from '../queues/queue.constants';
import { TasksService } from '../tasks/tasks.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';
import { TaskReconciliationService } from '../time-entries/task-reconciliation.service';

@Injectable()
@Processor(QUEUES.CLICKUP_TASKS, clickupWorkerOptions())
export class TaskSyncProcessor extends WorkerHost {
  constructor(
    private readonly tasks: TasksService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
    private readonly timeEntries: TimeEntriesRepository,
    private readonly reconciliation: TaskReconciliationService,
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
      } else if (job.name === JOBS.RECONCILE_CLICKUP_TASK) {
        const { startDate, endDate } = job.data as { taskId: string; startDate: number; endDate: number };
        result = await this.reconciliation.reconcileTask(job.data.taskId, startDate, endDate);
      } else {
        try {
          result = await this.tasks.syncTask(job.data.taskId);
        } catch (err) {
          // A ClickUp 404 means the task no longer exists there. Don't retry it
          // into a dead letter — handle it like the delete path: drop its tracked
          // time and soft-delete locally. Guard with exists(): unlike
          // reconcileTask (which only ever sees stored task IDs from findAllIds),
          // the sync path carries arbitrary webhook task IDs, and most 404s are
          // for tasks we never stored — skip those instead of writing thousands
          // of "Unknown Task" tombstones. ONLY a 404 counts as gone;
          // 401/403/5xx/network are access/transient and must still throw so the
          // job retries rather than deleting live data on a transient blip.
          if ((err as { response?: { status?: number } })?.response?.status !== 404) throw err;
          if (await this.tasks.exists(job.data.taskId)) {
            await this.timeEntries.deleteByTaskId(job.data.taskId);
            await this.tasks.softDeleteTask(job.data.taskId);
            await this.jobLogs.finished(log.id, { tasksSynced: 0 });
            return { taskId: job.data.taskId, deleted: true };
          }
          await this.jobLogs.finished(log.id, { tasksSynced: 0 });
          return { taskId: job.data.taskId, skipped: 'not-found-in-clickup' };
        }
      }
      await this.jobLogs.finished(log.id, { tasksSynced: 1 });
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}
