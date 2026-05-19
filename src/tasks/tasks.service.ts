import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupNormalizer } from '../clickup/clickup-normalizer';
import { TasksRepository } from './tasks.repository';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(private readonly clickup: ClickupClient, private readonly normalizer: ClickupNormalizer, private readonly repo: TasksRepository) {}

  async syncTask(taskId: string) {
    const task = await this.clickup.getTask(taskId);
    const normalized = this.normalizer.normalizeTask(task);
    await this.repo.upsert(normalized);
    this.logger.log(`Synced ClickUp task ${taskId}`);
    return normalized;
  }

  async syncTasks(tasks: unknown[]) {
    let count = 0;
    for (const raw of tasks) {
      const normalized = this.normalizer.normalizeTask(raw as any);
      await this.repo.upsert(normalized);
      count += 1;
    }
    return count;
  }

  async softDeleteTask(taskId: string) { return this.repo.softDelete(taskId); }

  patchSpaceNames(spaceId: string, spaceName: string) { return this.repo.patchSpaceNames(spaceId, spaceName); }
}
