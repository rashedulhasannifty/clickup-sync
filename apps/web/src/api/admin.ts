import { apiClient } from './client';

export type WorkspaceMember = {
  id: string;
  name: string | null;
  email: string | null;
};

export type ActiveBackfill = {
  spaceId: string;
  phase: 'fetching' | 'time-entries';
  total: number | null;
  done: number | null;
  remaining: number;
};

export type ReconcileProgress = {
  active: boolean;
  total: number;
  done: number;
  remaining: number;
};

export type DeadLetterJob = {
  id: string;
  queueName: string;
  jobName: string;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  failedAt: string;
  retriedAt: string | null;
  attemptsMade: number | null;
};

export type ExcludedAssignee = { id: string; name: string | null; email: string | null };

export interface RegisteredWebhookDto {
  id: string;
  endpoint: string | null;
  events: string[];
  health: { status: string; failCount: number } | null;
  missingEvents: string[];
  extraEvents: string[];
}
export interface WebhooksListDto {
  desiredEvents: string[];
  configuredEndpoint: string;
  webhooks: RegisteredWebhookDto[];
}

export type SpikeNoticePreview = {
  date: string;
  recipientEmail: string | null;
  userName: string | null;
  totalHours: number;
  tasks: { taskId: string; taskName: string; hours: number }[];
  alreadyNotified: boolean;
};

/**
 * One (task, assignee) chargeability rule, as the rules screen lists it.
 * A `type` rather than an `interface` on purpose: DataTable's row generic is
 * constrained to `{ [key: string]: unknown }`, and only type aliases get the
 * implicit index signature that satisfies it.
 */
export type ChargeabilityRule = {
  taskId: string;
  taskName: string | null;
  spaceName: string | null;
  userId: string;
  /** Borrowed from a time entry; null for a rule set before any time was logged. */
  userName: string | null;
  chargeable: boolean;
  note: string | null;
  setBy: string | null;
  updatedAt: string;
  entryCount: number;
  hours: number;
};

export const adminApi = {
  syncTask: (taskId: string) => apiClient.post('/admin/tasks/sync', { taskId }).then(r => r.data),
  backfill: (spaceId: string, lookbackDays?: number) =>
    apiClient.post('/admin/backfill', { spaceId, lookbackDays }).then(r => r.data),
  backfillActive: (): Promise<ActiveBackfill[]> =>
    apiClient.get('/admin/backfill/active').then((r) => (Array.isArray(r.data?.spaces) ? r.data.spaces : [])),
  reconcileTimeEntriesWindow: (lookbackDays?: number) =>
    apiClient.post('/admin/time-entries/reconcile-window', { lookbackDays }).then(r => r.data as { queued: number }),
  reconcileTasks: (lookbackDays?: number) =>
    apiClient.post('/admin/tasks/reconcile', undefined, {
      params: lookbackDays ? { lookbackDays } : undefined,
    }).then(r => r.data as { queued: number }),
  reconcileActive: (): Promise<ReconcileProgress> =>
    apiClient.get('/admin/tasks/reconcile/active').then(r => r.data as ReconcileProgress),
  registerWebhook: () => apiClient.post('/admin/webhooks/register').then(r => r.data),
  listWebhooks: (): Promise<WebhooksListDto> =>
    apiClient.get('/admin/webhooks').then((r) => r.data),
  deleteWebhook: (id: string): Promise<{ deleted: true; id: string }> =>
    apiClient.delete(`/admin/webhooks/${id}`).then((r) => r.data),
  pruneStaleWebhooks: (): Promise<{ deleted: { id: string; endpoint: string | null }[] }> =>
    apiClient.post('/admin/webhooks/prune-stale').then((r) => r.data),
  rotateWebhook: (): Promise<{ deletedId: string | null; rotated: boolean; result: { action: string; webhookId: string; secretStored?: boolean } }> =>
    apiClient.post('/admin/webhooks/rotate').then((r) => r.data),
  syncTaskTimeEntries: (taskId: string) =>
    apiClient.post('/admin/time-entries/sync-task', { taskId }).then((r) => r.data),
  retryFailedWebhooks: () =>
    apiClient
      .post('/admin/webhooks/retry-failed')
      .then((r) => r.data as { requeued: number; scanned: number; limit: number }),
  deadLetters: (limit = 50, offset = 0): Promise<{ items: DeadLetterJob[]; total: number }> =>
    apiClient
      .get('/admin/dead-letters', { params: { limit, offset } })
      .then((r) => ({ items: Array.isArray(r.data?.items) ? r.data.items : [], total: r.data?.total ?? 0 })),
  retryDeadLetter: (id: string) =>
    apiClient.post(`/admin/dead-letters/${id}/retry`).then((r) => r.data as { requeued: boolean; id: string }),
  retryAllDeadLetters: () =>
    apiClient.post('/admin/dead-letters/retry-all').then((r) => r.data as { requeued: number; scanned: number }),
  resolveDeadLetter: (id: string) =>
    apiClient.post(`/admin/dead-letters/${id}/resolve`).then((r) => r.data as { resolved: boolean; id: string }),
  workspaceMembers: (): Promise<WorkspaceMember[]> => apiClient.get('/admin/workspace-members').then(r => r.data),
  chargeabilityRules: (params: { limit?: number; offset?: number } = {}): Promise<{ items: ChargeabilityRule[]; total: number }> =>
    apiClient.get('/admin/chargeability-rules', { params }).then(r => r.data),
  searchTasks: (q: string): Promise<{ tasks: { taskId: string; taskName: string; status: string | null; client: string | null }[] }> =>
    apiClient.get('/admin/search', { params: { q } }).then(r => r.data),
  spikeNoticePreview: (userId: string, date: string): Promise<SpikeNoticePreview> =>
    apiClient
      .get(`/admin/hour-spikes/${encodeURIComponent(userId)}/${encodeURIComponent(date)}/preview`)
      .then((r) => r.data),
  notifySpike: (body: { userId: string; date: string; rule?: 'absolute' | 'relative' | 'both'; median?: number; note?: string }) =>
    apiClient
      .post('/admin/hour-spikes/notify', body)
      .then((r) => r.data as { sent: boolean; recipientEmail: string; date: string; totalHours: number }),
  resolveSpike: (body: { userId: string; date: string; userName?: string; note?: string }) =>
    apiClient.post('/admin/hour-spikes/resolve', body).then((r) => r.data as { resolved: boolean; date: string }),
  unresolveSpike: (body: { userId: string; date: string }) =>
    apiClient.delete('/admin/hour-spikes/resolve', { data: body }).then((r) => r.data as { resolved: boolean; date: string }),
  excludedAssignees: {
    get: (): Promise<ExcludedAssignee[]> =>
      apiClient.get('/admin/excluded-assignees').then((r) => (Array.isArray(r.data?.assignees) ? r.data.assignees : [])),
    put: (assignees: ExcludedAssignee[]) =>
      apiClient.put('/admin/excluded-assignees', { assignees }).then((r) => r.data as { assignees: ExcludedAssignee[]; recalculated: string[] }),
  },
  setTasksChargeable: (taskIds: string[], chargeable: boolean) =>
    apiClient.patch('/admin/tasks/chargeable', { taskIds, chargeable }).then(r => r.data as { updated: number; requested: number; queued: boolean }),
  // `note` is omitted from the body when undefined, not sent as null: the
  // repository treats undefined as "leave the stored note alone" and null as
  // "clear it", so a toggle that doesn't mention the note must not wipe it.
  setAssigneeChargeable: (taskId: string, userId: string, chargeable: boolean | null, note?: string | null) =>
    apiClient.patch(`/admin/tasks/${taskId}/assignee-chargeable`, { userId, chargeable, ...(note !== undefined ? { note } : {}) })
      .then(r => r.data as { changed: boolean; queued: boolean }),
};
