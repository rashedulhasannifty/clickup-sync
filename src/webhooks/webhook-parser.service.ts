import { Injectable } from '@nestjs/common';
import { sha256 } from '../common/utils/hash';

export interface ParsedWebhook { eventType: string | null; taskId: string | null; loggedUserId: string | null; fingerprint: string; payload: unknown; }

@Injectable()
export class WebhookParserService {
  parse(payload: any): ParsedWebhook {
    const body = payload?.body || payload || {};
    const eventType = body.event || payload?.event || null;
    const taskId = body.task_id || payload?.task_id || payload?.data?.task_id || payload?.history_items?.[0]?.task_id || body.history_items?.[0]?.task_id || null;
    const eventId = body.history_items?.[0]?.id || body.event_id || body.id || payload?.history_items?.[0]?.id || payload?.event_id || payload?.id;
    const fingerprint = eventId ? `id:${eventId}` : taskId && eventType ? `event:${eventType}:${taskId}:${body.date || body.timestamp || sha256(payload).slice(0, 12)}` : `hash:${sha256(payload)}`;
    // n8n source-of-truth: the taskTimeTrackedUpdated webhook carries the user who logged
    // the time in history_items[0].user.id — ClickUp's time_entries endpoint needs it as `assignee`.
    const rawLoggedUserId = body.history_items?.[0]?.user?.id ?? payload?.history_items?.[0]?.user?.id ?? null;
    const loggedUserId = rawLoggedUserId != null ? String(rawLoggedUserId) : null;
    return { eventType, taskId, loggedUserId, fingerprint, payload };
  }
}
