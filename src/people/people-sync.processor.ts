import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { JOBS, QUEUES } from '../queues/queue.constants';
import {
  SYNC_CRON_LOOKBACK_DAYS,
  SYNC_MAX_LOOKBACK_DAYS,
} from './people.constants';
import { ProviderRateLimitedError } from './attendance-provider';
import {
  PeopleSyncService,
  type PeopleSyncJobData,
} from './people-sync.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sole consumer of the `people-sync` queue. Its own queue and processor, not
 * `maintenance`: CostRecalcProcessor owns that queue and does not dispatch on
 * job name, so anything else added there would run as a cost recalculation.
 * Registered only in the worker role (see PeopleModule).
 */
@Injectable()
@Processor(QUEUES.PEOPLE_SYNC, { concurrency: 1 })
export class PeopleSyncProcessor extends WorkerHost {
  constructor(
    private readonly sync: PeopleSyncService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<Partial<PeopleSyncJobData>>, token?: string) {
    if (job.name !== JOBS.SYNC_ATTENDANCE) {
      // A name we do not own can never succeed by retrying.
      throw new UnrecoverableError(`people-sync: unknown job ${job.name}`);
    }
    const lookbackDays = job.data?.lookbackDays ?? SYNC_CRON_LOOKBACK_DAYS;
    if (
      !Number.isInteger(lookbackDays) ||
      lookbackDays < 1 ||
      lookbackDays > SYNC_MAX_LOOKBACK_DAYS
    ) {
      throw new UnrecoverableError(
        `people-sync: lookbackDays must be an integer in 1..${SYNC_MAX_LOOKBACK_DAYS}`,
      );
    }
    const { from, to } = job.data ?? {};
    const window = from || to ? { from: from ?? '', to: to ?? '' } : undefined;
    if (
      window &&
      !(ISO_DATE.test(window.from) && ISO_DATE.test(window.to) && window.from <= window.to)
    ) {
      throw new UnrecoverableError('people-sync: from/to must be YYYY-MM-DD with from <= to');
    }
    const trigger = job.data?.trigger ?? 'manual';
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.PEOPLE_SYNC,
      jobName: job.name,
      entityType: 'attendance',
      entityId: 'all',
      payload: { lookbackDays, trigger, ...(window ?? {}) },
    });
    try {
      const result = await this.sync.run(lookbackDays, window);
      await this.jobLogs.finished(log.id);
      // The older part of a long window: its own job, which waits for the provider's next call slot.
      if (result.remaining)
        await this.sync.enqueue(lookbackDays, trigger, result.remaining);
      return result;
    } catch (e) {
      if (e instanceof ProviderRateLimitedError && token) {
        // Not a failure: wait for the slot without spending an attempt.
        await this.jobLogs.finished(log.id, undefined, 'delayed', e.message);
        await job.moveToDelayed(e.retryAt.getTime() + 1_000, token);
        throw new DelayedError();
      }
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}
