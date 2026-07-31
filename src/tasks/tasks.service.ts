import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupNormalizer, NormalizedTask } from '../clickup/clickup-normalizer';
import { TasksRepository } from './tasks.repository';
import { ListsRepository } from '../lists/lists.repository';

type MinimalListRow = {
  listId: string | null; listName: string | null;
  folderId: string | null; folderName: string | null;
  spaceId: string | null; spaceName: string | null;
};

function toListRow(task: NormalizedTask): MinimalListRow {
  return {
    listId: task.listId, listName: task.listName,
    folderId: task.folderId, folderName: task.folderName,
    spaceId: task.spaceId, spaceName: task.spaceName,
  };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    private readonly clickup: ClickupClient,
    private readonly normalizer: ClickupNormalizer,
    private readonly repo: TasksRepository,
    private readonly lists: ListsRepository,
  ) {}

  /**
   * Best-effort catalog freshness: upsert the minimal list/folder/space fields
   * off already-normalized tasks into the list catalog. This must never fail
   * or abort a task sync — it is purely opportunistic, kept fresh between
   * authoritative catalog syncs (see ListCatalogService).
   */
  private async upsertListsOpportunistically(rows: MinimalListRow[]) {
    if (!rows.length) return;
    try {
      await this.lists.upsertMinimalFromTasks(rows);
    } catch (err: any) {
      this.logger.warn(`Skipped opportunistic list catalog upsert: ${err?.message ?? err}`);
    }
  }

  async syncTask(taskId: string) {
    const task = await this.clickup.getTask(taskId);
    const normalized = this.normalizer.normalizeTask(task);
    await this.repo.upsert(normalized);
    await this.upsertListsOpportunistically([toListRow(normalized)]);
    this.logger.log(`Synced ClickUp task ${taskId}`);
    return normalized;
  }

  async syncTasks(tasks: unknown[]) {
    let count = 0;
    let failed = 0;
    // Dedupe by listId as we go rather than retaining every full normalized
    // task (which carries the raw ClickUp payload) for the whole batch —
    // batches can be page-sized (100) or a full space during a reconcile, and
    // this codebase has already hit an OOM from whole-batch accumulation
    // elsewhere (see backfill streaming-persistence fix).
    const listRows = new Map<string, MinimalListRow>();
    for (const raw of tasks) {
      // Tolerant per-task: a single bad row (e.g. a field value that violates a
      // column constraint) must not abort the whole batch and fail an entire
      // space backfill. Log and skip it, then keep going — same policy as
      // syncMissingParents. Failures are surfaced in the count/log, not silent.
      try {
        const normalized = this.normalizer.normalizeTask(raw as any);
        await this.repo.upsert(normalized);
        if (normalized.listId) listRows.set(normalized.listId, toListRow(normalized));
        count += 1;
      } catch (err: any) {
        failed += 1;
        const taskId = (raw as { id?: string })?.id;
        this.logger.warn(`Skipped task ${taskId ?? '<unknown>'} during batch sync: ${err?.message ?? err}`);
      }
    }
    if (failed > 0) this.logger.warn(`Batch sync completed with ${failed} skipped task(s) of ${tasks.length}`);
    await this.upsertListsOpportunistically([...listRows.values()]);
    return count;
  }

  /**
   * Fetch and upsert parent tasks that are referenced by subtasks but not yet
   * stored locally — e.g. a parent updated outside a backfill's lookback window
   * so it never appears in the fetched page. Without this, the subtask's
   * parentTaskId points at a non-existent row and parent/subtask report joins
   * silently drop. Tolerant of per-id failures (a deleted/404 parent is logged
   * and skipped, not fatal to the batch). Returns the number actually synced.
   */
  async syncMissingParents(parentIds: string[]): Promise<number> {
    const missing = await this.repo.findMissingParentIds(parentIds);
    let synced = 0;
    for (const id of missing) {
      try {
        await this.syncTask(id);
        synced += 1;
      } catch (err: any) {
        this.logger.warn(`Could not fetch missing parent ${id}: ${err?.message ?? err}`);
      }
    }
    if (synced > 0) this.logger.log(`Fetched ${synced}/${missing.length} missing parent task(s)`);
    return synced;
  }

  async softDeleteTask(taskId: string) { return this.repo.softDelete(taskId); }
  /** Whether a task row exists locally (used to skip tombstoning 404s for tasks we never stored). */
  async exists(taskId: string) { return this.repo.exists(taskId); }

  patchSpaceNames(spaceId: string, spaceName: string) { return this.repo.patchSpaceNames(spaceId, spaceName); }
}
