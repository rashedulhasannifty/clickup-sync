import { Injectable } from '@nestjs/common';
import { ClickUpCustomField, ClickUpTask } from './clickup.types';
import { toNumberOrZero, toSafeInt32 } from '../common/utils/safe-value';

export interface ExtractedCustomFields { executiveName: string | null; department: string | null; client: string | null; cost: number; estimation: number; sprintName: string | null; sprintPoints: number; }

@Injectable()
export class CustomFieldExtractor {
  extract(task: ClickUpTask): ExtractedCustomFields {
    let executiveName: string | null = null;
    let department: string | null = null;
    let client: string | null = null;
    let cost = 0;
    let estimation = 0;
    let sprintName: string | null = null;
    let sprintPoints = toNumberOrZero(task.points ?? task.story_points);

    for (const cf of task.custom_fields || []) {
      const name = (cf.name || '').toLowerCase();
      const value = cf.value;
      if (value === undefined || value === null || value === '') continue;
      if (name === 'client' && cf.type === 'drop_down') client = this.resolveDropdown(cf, value);
      if (name.includes('executive')) executiveName = String(value);
      if (name.includes('department')) department = String(value);
      if (name.includes('cost')) cost = toNumberOrZero(value);
      if (name.includes('estimation') || name.includes('estimate')) estimation = toNumberOrZero(value);
      if (name.includes('sprint') && !name.includes('point')) sprintName = String(value);
      if (name.includes('point') || name.includes('story point') || name === 'sprint points') sprintPoints = Math.trunc(toNumberOrZero(value));
    }
    // sprint_points is an int4 column; a mis-matched custom field can carry a
    // value far beyond int4 range (the `name.includes('point')` match above is
    // broad). Clamp obvious garbage to 0 so it can't overflow and abort the upsert.
    return { executiveName, department, client, cost, estimation, sprintName, sprintPoints: toSafeInt32(sprintPoints) };
  }

  private resolveDropdown(cf: ClickUpCustomField, value: unknown): string | null {
    const selected = Number(value);
    const option = cf.type_config?.options?.find((opt) => opt.orderindex === selected);
    return option?.name || null;
  }
}
