import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { DeadLetterService } from "../jobs/dead-letter.service";
import { JobLogsRepository } from "../jobs/job-logs.repository";
import { JOBS, QUEUES } from "../queues/queue.constants";
import {
  SYNC_CRON_LOOKBACK_DAYS,
  SYNC_MAX_LOOKBACK_DAYS,
} from "./people.constants";
import {
  PeopleSyncService,
  type PeopleSyncJobData,
} from "./people-sync.service";

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

  @OnWorkerEvent("failed")
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<Partial<PeopleSyncJobData>>) {
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
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.PEOPLE_SYNC,
      jobName: job.name,
      entityType: "attendance",
      entityId: "all",
      payload: { lookbackDays, trigger: job.data?.trigger ?? "manual" },
    });
    try {
      const result = await this.sync.run(lookbackDays);
      await this.jobLogs.finished(log.id);
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}
