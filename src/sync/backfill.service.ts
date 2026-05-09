import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { TasksService } from '../tasks/tasks.service';
import { SyncCheckpointsRepository } from './sync-checkpoints.repository';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { subtractDays } from '../common/utils/date-utils';

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  constructor(private readonly clickup: ClickupClient, private readonly tasks: TasksService, private readonly checkpoints: SyncCheckpointsRepository) {}

  async backfillSpace(spaceId: string, lookbackDays?: number) {
    const space = CLICKUP_SPACES.find((s) => s.id === spaceId);
    const days = lookbackDays ?? space?.backfillLookbackDays ?? 7;
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';
    await this.checkpoints.markAttempt('clickup', 'space', spaceId);
    const tasks = await this.clickup.getAllTasksBySpace(spaceId, { teamId, dateUpdatedGt: subtractDays(days).getTime(), includeClosed: true, subtasks: true });
    const parentTasks = tasks.filter((t) => !t.parent);
    const subtasks = tasks.filter((t) => !!t.parent);
    await this.tasks.syncTasks(parentTasks);
    await this.tasks.syncTasks(subtasks);
    await this.checkpoints.markSuccess('clickup', 'space', spaceId);
    this.logger.log(`Backfilled ${tasks.length} tasks for ${space?.name || spaceId}`);
    return { total: tasks.length, parents: parentTasks.length, subtasks: subtasks.length };
  }
}
