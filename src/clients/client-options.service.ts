import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import type { ClickUpCustomField } from '../clickup/clickup.types';
import { SettingsService } from '../settings/settings.service';
import { ClientOptionsRepository } from './client-options.repository';

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
    return { upserted, archived };
  }
}
