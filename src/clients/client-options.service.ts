import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import type { ClickUpCustomField } from '../clickup/clickup.types';
import { SettingsService } from '../settings/settings.service';
import { ClientOptionsRepository } from './client-options.repository';
import { ClientNameResolver } from './client-name.resolver';

/** Pure: the Client dropdown's options from ClickUp field definitions. */
export function extractClientOptions(fields: ClickUpCustomField[]) {
  const out: { fieldId: string; optionId: string; name: string }[] = [];
  for (const f of fields) {
    if ((f.name ?? '').trim().toLowerCase() !== 'client' || f.type !== 'drop_down' || !f.id) continue;
    for (const o of f.type_config?.options ?? []) {
      const name = (o.name ?? '').trim();
      if (o.id && name) out.push({ fieldId: f.id, optionId: o.id, name });
    }
  }
  return out;
}

@Injectable()
export class ClientOptionsService {
  private readonly logger = new Logger(ClientOptionsService.name);
  constructor(
    private readonly clickup: ClickupClient,
    private readonly repo: ClientOptionsRepository,
    private readonly settings: SettingsService,
    private readonly names: ClientNameResolver,
  ) {}

  /** Refresh the catalog from workspace-level and this space's Client fields. */
  async syncSpace(spaceId: string) {
    const [ws, sp] = await Promise.all([
      this.clickup.getWorkspaceFields(this.settings.getTeamId()),
      this.clickup.getSpaceFields(spaceId),
    ]);
    const byField = new Map<string, Map<string, string>>();
    for (const o of extractClientOptions([...ws, ...sp])) {
      if (!byField.has(o.fieldId)) byField.set(o.fieldId, new Map());
      byField.get(o.fieldId)!.set(o.optionId, o.name);
    }
    let upserted = 0;
    let archived = 0;
    for (const [fieldId, opts] of byField) {
      const r = await this.repo.upsertForField(
        fieldId,
        [...opts].map(([optionId, name]) => ({ optionId, name })),
      );
      upserted += r.upserted;
      archived += r.archived;
    }
    this.logger.log(`Client options for space ${spaceId}: ${upserted} upserted, ${archived} archived`);

    // The catalog is the only record of an option's current name, so the moment
    // it is refreshed is the moment stale task rows can be corrected. Runs on
    // every sync, not just when a rename is detected: a task synced from a
    // cached ClickUp payload can reintroduce an old name at any time.
    this.names.invalidate();
    const repaired = await this.repo.repairClientNames();
    if (repaired.tasks > 0) {
      const moves = repaired.renames.map((r) => `"${r.from}" → "${r.to}"`).join(', ');
      this.logger.log(`Renamed client on ${repaired.tasks} task(s) and ${repaired.budgets} budget(s): ${moves}`);
    }
    if (repaired.conflicts > 0) {
      this.logger.warn(
        `${repaired.conflicts} budget row(s) kept an outdated client name: a budget already exists for the new name in the same period`,
      );
    }
    return { upserted, archived, repairedTasks: repaired.tasks };
  }
}
