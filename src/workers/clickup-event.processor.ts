import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import * as crypto from 'crypto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { WebhookEventsRepository } from '../webhooks/webhook-events.repository';
import { WebhookParserService } from '../webhooks/webhook-parser.service';
import { PrismaService } from '../database/prisma.service';
import { DeadLetterService } from '../jobs/dead-letter.service';

/**
 * Webhook event types whose ClickUp `history_items` we record into
 * `clickup_task_events`, mapped to the history `field` names to extract.
 * status is history-only; moved/assignee/priority ALSO re-sync the task (they
 * change current task state) — see process().
 */
const HISTORY_FIELDS: Record<string, string[]> = {
  taskStatusUpdated: ['status'],
  taskPriorityUpdated: ['priority'],
  taskAssigneeUpdated: ['assignee_add', 'assignee_rem'],
  taskMoved: ['section_moved'],
};

// Events after which a task's tracked time may have changed, so we re-sync its
// time entries. `taskTimeTrackedUpdated` is the intended signal but fires
// unreliably on ClickUp; `taskCreated`/`taskUpdated` are the reliable fallback
// because logging time bumps the task's `date_updated`. See process().
const TIME_ENTRY_SYNC_EVENTS = new Set([
  'taskTimeTrackedUpdated',
  'taskUpdated',
  'taskCreated',
]);

@Injectable()
@Processor(QUEUES.CLICKUP_WEBHOOKS)
export class ClickupEventProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickupEventProcessor.name);
  constructor(
    private readonly queues: QueueService,
    private readonly events: WebhookEventsRepository,
    private readonly parser: WebhookParserService,
    private readonly prisma: PrismaService,
    private readonly deadLetters: DeadLetterService,
  ) { super(); }

  /**
   * Fires after every failed attempt. Once BullMQ has exhausted retries we
   * (a) dead-letter the job and (b) flip the webhook event to `failed` so the
   * admin "retry failed webhooks" tool — which queries `status:'failed'` — can
   * actually find and re-enqueue it. Without this the event stays `received`
   * forever and the retry tool is a no-op.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<any>, err: Error) {
    const exhausted = await this.deadLetters.recordIfExhausted(job, err);
    const fingerprint = job?.data?.fingerprint as string | undefined;
    if (exhausted && fingerprint) {
      await this.events
        .markFailed(fingerprint, err?.message ?? String(err))
        .catch((e) => this.logger.warn(`markFailed(${fingerprint}) failed: ${e.message}`));
    }
  }

  async process(job: Job<any>) {
    const { eventType, taskId, fingerprint, loggedUserId, payload } = job.data;

    // Record field-change history (status / priority / assignee / move) into
    // clickup_task_events. Safe for null taskId (persist no-ops).
    if (eventType && HISTORY_FIELDS[eventType]) {
      await this.persistFieldChanges(taskId, eventType, HISTORY_FIELDS[eventType], payload);
    }

    // taskStatusUpdated is treated as history-only here; current-state refresh
    // relies on a taskUpdated event if/when ClickUp fires one alongside it.
    // moved/assignee/priority fall through below so they also re-sync the task.
    if (eventType === 'taskStatusUpdated') {
      await this.events.markProcessed(fingerprint).catch((e) => this.logger.warn(e.message));
      return;
    }

    // No resolvable taskId → nothing actionable. Acknowledge it (markProcessed)
    // so it doesn't sit in `received` limbo forever, invisible to the "retry
    // failed" tool (which only queries `failed`). This also covers a taskDeleted
    // that arrives with no taskId: enqueuing a delete for a null id just throws
    // in the worker (softDeleteTask(null)) and dead-letters a job that could
    // never succeed.
    if (!taskId) {
      this.logger.warn(`Webhook event ${fingerprint} (${eventType ?? 'unknown'}) has no taskId — nothing to do, marking processed`);
      await this.events.markProcessed(fingerprint).catch((e) => this.logger.warn(e.message));
      return;
    }
    if (eventType === 'taskDeleted') {
      await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.DELETE_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());
    } else {
      // Always re-sync the task's current state. This also guarantees the parent
      // task row exists before the time-entry worker upserts FKs against it (the
      // time-entry worker self-heals too — see TimeEntriesService — but
      // enqueueing both decouples the paths so either can recover alone). All
      // jobs are idempotent.
      await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.SYNC_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());

      // Re-sync tracked time whenever it may have changed. ClickUp's
      // `taskTimeTrackedUpdated` webhook is unreliable — it frequently does NOT
      // fire for manually added/edited time entries (only for timer start/stop),
      // so relying on it alone leaves tracked time invisible in reporting. But
      // logging time bumps the task's `date_updated`, which DOES reliably fire
      // `taskUpdated`. So we also sync time entries on taskCreated/taskUpdated,
      // making tracked time reflect in near real time regardless of whether the
      // time-tracking event fires. When that event itself fires we know the
      // logger and scope to them (cheaper); otherwise (taskCreated/taskUpdated)
      // we sync all workspace members' entries on the task.
      if (TIME_ENTRY_SYNC_EVENTS.has(eventType)) {
        const assigneeIds = eventType === 'taskTimeTrackedUpdated' && loggedUserId ? [loggedUserId] : undefined;
        await this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES).add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, assigneeIds }, this.queues.defaultJobOptions());
      }
    }
    await this.events.markProcessed(fingerprint).catch((e) => this.logger.warn(e.message));
  }

  private async persistFieldChanges(
    taskId: string | null,
    eventType: string,
    fields: string[],
    payload: unknown,
  ) {
    if (!taskId) return;
    const records = this.parser.extractFieldChanges(payload, fields);
    for (const r of records) {
      // Fingerprint deliberately omits `field`: eventType namespaces the row and
      // distinct before/after (or dates) separate items within one payload —
      // e.g. assignee_add vs assignee_rem yield different rows. This keeps the
      // status fingerprint byte-identical to the pre-generalization formula.
      const fp = crypto
        .createHash('sha256')
        .update([
          taskId,
          eventType,
          r.occurredAt.toISOString(),
          JSON.stringify(r.before),
          JSON.stringify(r.after),
        ].join('|'))
        .digest('hex');
      try {
        await this.prisma.clickupTaskEvent.upsert({
          where: { fingerprint: fp },
          create: {
            taskId,
            eventType,
            occurredAt: r.occurredAt,
            changedByUserId: r.changedByUserId,
            changedByUserName: r.changedByUserName,
            before: r.before as any,
            after: r.after as any,
            fingerprint: fp,
            raw: r.raw as any,
          },
          update: {},
        });
      } catch (err) {
        this.logger.error(`Failed to persist task event for ${taskId}`, err as Error);
      }
    }
  }
}
