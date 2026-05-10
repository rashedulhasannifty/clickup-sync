import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupNormalizer } from '../clickup/clickup-normalizer';
import { TagAssigneeMapRepository } from './tag-assignee-map.repository';
import { TimeEntryReplacementsRepository } from './time-entry-replacements.repository';
import { CostCalculatorService } from './cost-calculator.service';
import { TimeEntriesRepository } from './time-entries.repository';

export interface ReplacementJobData {
  timeEntryId: string;
  taskId: string;
  startMs: number;
  endMs: number;
  durationHours: number;
  billable: boolean;
  description?: string;
}

@Injectable()
export class AssigneeReplacementService {
  private readonly logger = new Logger(AssigneeReplacementService.name);

  constructor(
    private readonly clickup: ClickupClient,
    private readonly normalizer: ClickupNormalizer,
    private readonly tagAssigneeMap: TagAssigneeMapRepository,
    private readonly replacements: TimeEntryReplacementsRepository,
    private readonly costs: CostCalculatorService,
    private readonly timeEntries: TimeEntriesRepository,
  ) {}

  async replaceEntry(data: ReplacementJobData): Promise<{ status: 'replaced' | 'skipped' | 'no_mapping' }> {
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';

    // 1. Idempotency check
    const existing = await this.replacements.findByOriginalEntryId(data.timeEntryId);
    if (existing) {
      this.logger.log(`Time entry ${data.timeEntryId} already replaced — skipping`);
      return { status: 'skipped' };
    }

    // 2. Fetch task to get tags
    let tagName: string | null = null;
    try {
      const task = await this.clickup.getTask(data.taskId);
      const tags = task.tags?.map((t) => t.name?.toLowerCase()).filter(Boolean) ?? [];
      const activeMap = await this.tagAssigneeMap.findAllActive();
      const activeTagNames = new Set(activeMap.map((m) => m.tagName));
      const matchedTag = tags.find((t) => activeTagNames.has(t!)) ?? null;
      tagName = matchedTag ?? null;
    } catch (err: any) {
      this.logger.warn(`Could not fetch task ${data.taskId} to resolve tags: ${err?.message}`);
    }

    // 3. No mapping found — skip
    if (!tagName) {
      this.logger.warn(`No tag→assignee mapping for task ${data.taskId} time entry ${data.timeEntryId} — leaving as-is`);
      return { status: 'no_mapping' };
    }

    const mapping = await this.tagAssigneeMap.findByTagName(tagName);
    if (!mapping) return { status: 'no_mapping' };

    const realUserId = mapping.clickupUserId;

    // 4. Create replacement entry in ClickUp
    const created = await this.clickup.createTimeEntry(teamId, {
      start: data.startMs,
      stop: data.endMs,
      description: data.description,
      billable: data.billable,
      tid: data.taskId,
      assignee: Number(realUserId),
    });

    // 5. Persist audit row immediately (before deleting original)
    await this.replacements.create({
      originalEntryId: data.timeEntryId,
      replacementEntryId: created.id,
      taskId: data.taskId,
      originalUserId: process.env.CLICKUP_AGENCY_USER_ID || '3584055',
      replacedUserId: realUserId,
      tagName,
      status: 'replaced',
    });

    // 6. Delete original entry only after audit row committed
    await this.clickup.deleteTimeEntry(teamId, data.timeEntryId);

    // 7. Upsert replacement entry into local DB with recalculated cost
    const startTime = new Date(data.startMs);
    const cost = await this.costs.calculate(realUserId, startTime, data.durationHours);
    const normalized = this.normalizer.normalizeTimeEntry(created);
    await this.timeEntries.upsert(normalized, cost);

    if (cost.status === 'NO_RATE_FOUND') {
      this.logger.warn(`No rate found for replaced user ${realUserId} on entry ${created.id}`);
    }

    this.logger.log(`Replaced time entry ${data.timeEntryId} → ${created.id} for user ${realUserId} (tag: ${tagName})`);
    return { status: 'replaced' };
  }
}
