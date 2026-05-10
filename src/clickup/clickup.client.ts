import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ClickUpMember, ClickUpTask, ClickUpTaskPage, ClickUpTimeEntry, ClickUpWebhook, CreateTimeEntryPayload } from './clickup.types';

@Injectable()
export class ClickupClient {
  private readonly logger = new Logger(ClickupClient.name);
  private readonly baseUrl = 'https://api.clickup.com/api/v2';

  constructor(private readonly http: HttpService) {}

  private headers() { return { Authorization: process.env.CLICKUP_API_TOKEN || '' }; }

  private async request<T>(method: 'GET'|'POST'|'DELETE', path: string, data?: unknown): Promise<T> {
    try {
      const response = await firstValueFrom(this.http.request<T>({ method, url: `${this.baseUrl}${path}`, data, headers: this.headers(), timeout: 30000 }));
      return response.data;
    } catch (error: any) {
      this.logger.error(`ClickUp ${method} ${path} failed: ${error?.response?.status || ''} ${error?.message}`);
      throw error;
    }
  }

  getTask(taskId: string): Promise<ClickUpTask> { return this.request('GET', `/task/${taskId}?include_subtasks=true`); }

  getTasksBySpace(spaceId: string, options: { teamId: string; dateUpdatedGt?: number; page?: number; includeClosed?: boolean; subtasks?: boolean; limit?: number; }): Promise<ClickUpTaskPage> {
    const params = new URLSearchParams();
    params.append('space_ids[]', spaceId);
    if (options.dateUpdatedGt) params.append('date_updated_gt', String(options.dateUpdatedGt));
    params.append('include_closed', String(options.includeClosed ?? true));
    params.append('subtasks', String(options.subtasks ?? true));
    params.append('page', String(options.page ?? 0));
    params.append('limit', String(options.limit ?? 100));
    return this.request('GET', `/team/${options.teamId}/task?${params.toString()}`);
  }

  async getAllTasksBySpace(spaceId: string, options: { teamId: string; dateUpdatedGt?: number; includeClosed?: boolean; subtasks?: boolean }): Promise<ClickUpTask[]> {
    const all: ClickUpTask[] = [];
    for (let page = 0; page < 1000; page++) {
      const res = await this.getTasksBySpace(spaceId, { ...options, page, limit: 100 });
      const tasks = res.tasks || [];
      all.push(...tasks);
      if (tasks.length < 100) break;
    }
    return all;
  }

  async getTimeEntries(teamId: string, taskId: string, assigneeId?: string): Promise<ClickUpTimeEntry[]> {
    const params = new URLSearchParams({ task_id: taskId });
    if (assigneeId) params.append('assignee', assigneeId);
    const res: any = await this.request('GET', `/team/${teamId}/time_entries?${params.toString()}`);
    return res.data || res.entries || [];
  }

  async getTeamMembers(teamId: string): Promise<ClickUpMember[]> {
    const res: any = await this.request('GET', `/team/${teamId}`);
    return res.team?.members || [];
  }

  async getWebhooks(teamId: string): Promise<ClickUpWebhook[]> {
    const res: any = await this.request('GET', `/team/${teamId}/webhook`);
    return res.webhooks || [];
  }
  async createWebhook(teamId: string, endpoint: string, events: string[]): Promise<{ id: string; secret: string }> {
    const res: any = await this.request('POST', `/team/${teamId}/webhook`, { endpoint, events });
    return { id: res.webhook?.id ?? res.id, secret: res.webhook?.secret ?? res.secret ?? '' };
  }
  async deleteWebhook(webhookId: string): Promise<void> { await this.request('DELETE', `/webhook/${webhookId}`); }

  async createTimeEntry(teamId: string, payload: CreateTimeEntryPayload): Promise<ClickUpTimeEntry> {
    const res: any = await this.request('POST', `/team/${teamId}/time_entries`, payload);
    return res.data;
  }

  async deleteTimeEntry(teamId: string, entryId: string): Promise<void> { await this.request('DELETE', `/team/${teamId}/time_entries/${entryId}`); }
}
