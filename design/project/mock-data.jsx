// Realistic mock data for the ClickUp Sync Dashboard

const SPACES = [
  { id: '3589129', name: 'R&D Apps', color: '#7B68EE' },
  { id: '3577824', name: 'Digital Marketing', color: '#FF02F0' },
  { id: '3525433', name: 'Projects', color: '#49CCF9' },
];

const ASSIGNEES = [
  { id: 'u_001', name: 'Ahmad Khan', email: 'ahmad@nifty.co', initials: 'AK', color: '#7B68EE', rate: 4500, currency: 'USD', hasRate: true },
  { id: 'u_002', name: 'Chisty Rahman', email: 'chisty@nifty.co', initials: 'CR', color: '#FF02F0', rate: 5200, currency: 'USD', hasRate: true },
  { id: 'u_003', name: 'Fahim Ahmed', email: 'fahim@nifty.co', initials: 'FA', color: '#49CCF9', rate: 3800, currency: 'USD', hasRate: true },
  { id: 'u_004', name: 'Rashedul Islam', email: 'rashedul@nifty.co', initials: 'RI', color: '#10b981', rate: 4200, currency: 'USD', hasRate: true },
  { id: 'u_005', name: 'Rejaur Hossain', email: 'rejaur@nifty.co', initials: 'RH', color: '#f59e0b', rate: null, currency: null, hasRate: false },
  { id: 'u_006', name: 'Sayem Ali', email: 'sayem@nifty.co', initials: 'SA', color: '#ef4444', rate: 3500, currency: 'USD', hasRate: true },
  { id: 'u_007', name: 'Nadia Karim', email: 'nadia@nifty.co', initials: 'NK', color: '#06b6d4', rate: null, currency: null, hasRate: false },
  { id: 'u_008', name: 'Tariq Hasan', email: 'tariq@nifty.co', initials: 'TH', color: '#8b5cf6', rate: 4800, currency: 'USD', hasRate: true },
  { id: 'u_009', name: 'Imran Sheikh', email: 'imran@nifty.co', initials: 'IS', color: '#ec4899', rate: 4100, currency: 'USD', hasRate: true },
  { id: 'u_010', name: 'Farhana Begum', email: 'farhana@nifty.co', initials: 'FB', color: '#14b8a6', rate: null, currency: null, hasRate: false },
];

const CLIENTS = ['Acme Logistics', 'Northwind Health', 'Globex Media', 'Initech Capital', 'Stark Retail', 'Wayne Foundation', 'Internal'];
const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Operations', 'Product', 'QA'];
const STATUSES = [
  { name: 'open', color: '#94a3b8', type: 'open' },
  { name: 'in progress', color: '#3b82f6', type: 'open' },
  { name: 'in review', color: '#a855f7', type: 'open' },
  { name: 'blocked', color: '#ef4444', type: 'open' },
  { name: 'closed', color: '#10b981', type: 'closed' },
  { name: 'archived', color: '#64748b', type: 'closed' },
];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

const TASK_TITLES = [
  'Implement webhook signature verification middleware',
  'Migrate assignee rate sync from Google Sheets to native admin UI',
  'Add idempotent retry handler for taskTimeTrackedUpdated events',
  'Q3 brand refresh — landing page hero variations',
  'Investigate duplicate fingerprint collisions on backfill',
  'Build cost recalculation worker for rate-change backfill',
  'Onboarding flow redesign — mobile checkout',
  'BullMQ dashboard auth + RBAC',
  'Sprint 47 retro action items',
  'Acme Logistics — fleet routing prototype',
  'Northwind Health portal — accessibility audit',
  'SEO content calendar — May–July',
  'Refactor ClickUp client to typed DTOs',
  'Add structured logging with request IDs',
  'Design system: status pill component spec',
  'Globex campaign — landing variants A/B',
  'Stark Retail kiosk firmware OTA',
  'Quarterly cost report — finance review',
  'Webhook dead letter queue UI',
  'Reduce p95 of /api/tasks endpoint',
  'Backfill missing parent task references',
  'Time entry CSV export performance',
  'Initech onboarding deck — investor v3',
  'Wayne Foundation grant tracker — phase 2',
  'Audit logs viewer for rate edits',
];

const SPRINTS = ['Sprint 45', 'Sprint 46', 'Sprint 47', 'Sprint 48', 'Backlog'];
const LISTS = ['Backlog', 'Active', 'In Review', 'QA', 'Shipped', 'Blocked'];
const FOLDERS = ['Platform', 'Growth', 'Client Work', 'Internal Tools', 'Infra'];

function rand(arr, seed) { return arr[Math.floor((seed * 9301 + 49297) % 233280) % arr.length]; }
function seededRand(seed) { return ((seed * 9301 + 49297) % 233280) / 233280; }

// Generate 64 tasks
const TASKS = Array.from({ length: 64 }, (_, i) => {
  const space = SPACES[i % 3];
  const status = STATUSES[i % STATUSES.length];
  const assigneeCount = (i % 3) + 1;
  const assignees = Array.from({ length: assigneeCount }, (_, j) => ASSIGNEES[(i + j) % ASSIGNEES.length]);
  const isParent = i % 5 !== 0;
  const timeSpent = Math.round(seededRand(i + 1) * 40 * 100) / 100;
  const timeEst = Math.round((timeSpent + seededRand(i + 7) * 8) * 100) / 100;
  const sprintPoints = i % 4 === 0 ? null : (1 + (i % 8));
  const updatedHours = Math.floor(seededRand(i + 3) * 240);
  const createdHours = updatedHours + Math.floor(seededRand(i + 5) * 1000);
  return {
    task_id: `86a${(i + 100).toString(16).padStart(4, '0')}`,
    parent_task_id: isParent ? null : TASKS_PARENT_ID(i),
    task_name: TASK_TITLES[i % TASK_TITLES.length],
    description: `Operational notes for ${TASK_TITLES[i % TASK_TITLES.length]}.`,
    url: `https://app.clickup.com/t/86a${(i + 100).toString(16).padStart(4, '0')}`,
    status: status.name,
    status_type: status.type,
    status_color: status.color,
    priority: PRIORITIES[i % 4],
    archived: status.name === 'archived',
    space_id: space.id,
    space_name: space.name,
    folder_name: FOLDERS[i % FOLDERS.length],
    list_name: LISTS[i % LISTS.length],
    assignees,
    creator_name: ASSIGNEES[(i + 2) % ASSIGNEES.length].name,
    executive_name: ASSIGNEES[(i + 1) % ASSIGNEES.length].name,
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    client: CLIENTS[i % CLIENTS.length],
    cost: Math.round(timeSpent * 4500),
    estimation: Math.round(timeEst * 4500),
    sprint_name: SPRINTS[i % SPRINTS.length],
    sprint_points: sprintPoints,
    time_estimate: timeEst,
    time_spent: timeSpent,
    tags: i % 2 === 0 ? 'backend, p1' : 'design, p2',
    created_date: new Date(Date.now() - createdHours * 3600_000).toISOString(),
    updated_date: new Date(Date.now() - updatedHours * 3600_000).toISOString(),
    closed_date: status.type === 'closed' ? new Date(Date.now() - updatedHours * 3600_000).toISOString() : null,
    due_date: new Date(Date.now() + (seededRand(i + 11) * 30 - 5) * 86400_000).toISOString(),
    start_date: new Date(Date.now() - createdHours * 3600_000).toISOString(),
    synced_at: new Date(Date.now() - Math.floor(seededRand(i + 9) * 60) * 60_000).toISOString(),
    sync_count: 1 + (i % 8),
  };
});

function TASKS_PARENT_ID(i) {
  return `86a${(((i + 100) - 1)).toString(16).padStart(4, '0')}`;
}

// Time entries — about 120, some with NO_RATE_FOUND
const TIME_ENTRIES = Array.from({ length: 120 }, (_, i) => {
  const task = TASKS[i % TASKS.length];
  const user = ASSIGNEES[i % ASSIGNEES.length];
  const duration = Math.round(seededRand(i + 13) * 6 * 100) / 100;
  const startHoursAgo = Math.floor(seededRand(i + 17) * 720);
  const start = new Date(Date.now() - startHoursAgo * 3600_000);
  const end = new Date(start.getTime() + duration * 3600_000);
  const status = user.hasRate ? 'COST_CALCULATED' : 'NO_RATE_FOUND';
  return {
    time_entry_id: `te_${(1000 + i).toString()}`,
    task_id: task.task_id,
    task_name: task.task_name,
    user_id: user.id,
    user_name: user.name,
    user_email: user.email,
    user,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_hours: duration,
    billable: i % 4 !== 0,
    description: i % 3 === 0 ? `Working on ${task.task_name.slice(0, 32)}…` : null,
    rate_id: user.hasRate ? `r_${user.id}_active` : null,
    currency: user.currency,
    hourly_rate_cents: user.rate,
    cost_cents: user.hasRate ? Math.round(duration * user.rate) : null,
    synced_at: new Date(Date.now() - Math.floor(seededRand(i + 21) * 30) * 60_000).toISOString(),
    status,
    space_name: task.space_name,
    space_id: task.space_id,
  };
});

// Assignee rates — current + history
const ASSIGNEE_RATES = [];
ASSIGNEES.forEach((u, idx) => {
  if (!u.hasRate) return;
  // Older rate (closed)
  ASSIGNEE_RATES.push({
    rate_id: `r_${u.id}_v1`,
    assignee_id: u.id,
    assignee_name: u.name,
    assignee_email: u.email,
    currency: u.currency,
    hourly_rate_cents: u.rate - 500,
    valid_from: '2024-01-01',
    valid_to: '2024-12-31',
    is_active: false,
    updated_at: '2024-12-15T10:00:00Z',
    created_at: '2024-01-01T10:00:00Z',
  });
  // Active rate
  ASSIGNEE_RATES.push({
    rate_id: `r_${u.id}_active`,
    assignee_id: u.id,
    assignee_name: u.name,
    assignee_email: u.email,
    currency: u.currency,
    hourly_rate_cents: u.rate,
    valid_from: '2025-01-01',
    valid_to: null,
    is_active: true,
    updated_at: '2025-02-12T10:00:00Z',
    created_at: '2025-01-01T10:00:00Z',
  });
  // Synthetic overlap warning for one assignee
  if (idx === 1) {
    ASSIGNEE_RATES.push({
      rate_id: `r_${u.id}_overlap`,
      assignee_id: u.id,
      assignee_name: u.name,
      assignee_email: u.email,
      currency: u.currency,
      hourly_rate_cents: u.rate + 300,
      valid_from: '2024-11-01',
      valid_to: '2025-03-15',
      is_active: false,
      _warning: 'overlap',
      updated_at: '2024-11-01T10:00:00Z',
      created_at: '2024-11-01T10:00:00Z',
    });
  }
});

// Sync logs / webhook events
const EVENT_TYPES = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskTimeTrackedUpdated'];
const SYNC_LOGS = Array.from({ length: 80 }, (_, i) => {
  const eventType = EVENT_TYPES[i % EVENT_TYPES.length];
  const task = TASKS[i % TASKS.length];
  const isDup = i % 11 === 0;
  const isFail = i % 17 === 0;
  const isProc = i === 0;
  const status = isProc ? 'processing' : isFail ? 'failed' : isDup ? 'skipped' : 'success';
  const createdMin = Math.floor(seededRand(i + 23) * 60 * 24 * 7);
  const created = new Date(Date.now() - createdMin * 60_000);
  const procDelay = Math.floor(seededRand(i + 29) * 800) + 50;
  return {
    id: `wh_${(10000 + i).toString()}`,
    fingerprint: `${eventType}:${task.task_id}:${createdMin}`,
    event_type: eventType,
    task_id: task.task_id,
    task_name: task.task_name,
    already_seen: isDup,
    action: eventType === 'taskCreated' ? 'create' : eventType === 'taskDeleted' ? 'delete' : 'upsert',
    processed_status: status,
    error_message: isFail ? 'ClickUp 429: rate limit exceeded — retry scheduled' : null,
    created_at: created.toISOString(),
    processed_at: status === 'processing' ? null : new Date(created.getTime() + procDelay).toISOString(),
    space_name: task.space_name,
    payload: {
      event: eventType,
      task_id: task.task_id,
      webhook_id: `wb_${task.space_id}`,
      history_items: [{ field: 'status', before: 'open', after: 'in progress' }],
      team_id: '3450636',
    },
  };
});

// Missing rate issues — grouped by assignee
const MISSING_RATE_ISSUES = ASSIGNEES.filter(u => !u.hasRate).map(u => {
  const entries = TIME_ENTRIES.filter(te => te.user_id === u.id);
  const dates = entries.map(te => new Date(te.start_time).getTime()).sort((a, b) => a - b);
  return {
    assignee: u,
    missing_count: entries.length,
    affected_hours: Math.round(entries.reduce((s, e) => s + e.duration_hours, 0) * 10) / 10,
    first_date: dates.length ? new Date(dates[0]).toISOString() : null,
    latest_date: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null,
    estimated_missing_cost_cents: Math.round(entries.reduce((s, e) => s + e.duration_hours, 0) * 4200),
    issue_type: u.id === 'u_005' ? 'No active rate' : u.id === 'u_007' ? 'Time entry outside valid rate range' : 'No active rate',
    severity: entries.length > 10 ? 'high' : entries.length > 5 ? 'medium' : 'low',
    affected_tasks: [...new Set(entries.map(e => e.task_name))].slice(0, 5),
    entries,
  };
});

const OVERVIEW_METRICS = {
  total_tasks: TASKS.length,
  open_tasks: TASKS.filter(t => t.status_type === 'open').length,
  closed_tasks: TASKS.filter(t => t.status_type === 'closed' && !t.archived).length,
  archived_tasks: TASKS.filter(t => t.archived).length,
  total_time_hours: Math.round(TIME_ENTRIES.reduce((s, e) => s + e.duration_hours, 0) * 10) / 10,
  total_cost_cents: TIME_ENTRIES.reduce((s, e) => s + (e.cost_cents || 0), 0),
  missing_rate_count: TIME_ENTRIES.filter(e => e.status === 'NO_RATE_FOUND').length,
  failed_event_count: SYNC_LOGS.filter(s => s.processed_status === 'failed').length,
  duplicate_event_count: SYNC_LOGS.filter(s => s.processed_status === 'skipped').length,
  last_sync_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  webhook_status: 'healthy',
  successful_events: SYNC_LOGS.filter(s => s.processed_status === 'success').length,
};

// Sync runs (full reconciliation runs, distinct from per-event webhook logs)
const RUN_TYPES = ['scheduled', 'manual', 'backfill'];
const SYNC_RUNS = Array.from({ length: 24 }, (_, i) => {
  const startedAt = new Date(Date.now() - (i * 60 * 60_000) - Math.random() * 30 * 60_000);
  const duration = 8000 + Math.random() * 90_000;
  const status = i === 0 ? 'running' : (i % 9 === 3 ? 'failed' : (i % 11 === 5 ? 'partial' : 'success'));
  const eventsProcessed = status === 'failed' ? Math.floor(Math.random() * 200) : 800 + Math.floor(Math.random() * 4200);
  return {
    run_id: `run_${(2000 - i).toString().padStart(5, '0')}`,
    type: RUN_TYPES[i % RUN_TYPES.length],
    status,
    started_at: startedAt.toISOString(),
    finished_at: status === 'running' ? null : new Date(startedAt.getTime() + duration).toISOString(),
    duration_ms: status === 'running' ? null : Math.round(duration),
    events_processed: eventsProcessed,
    events_failed: status === 'failed' ? Math.floor(Math.random() * 30) + 5 : (status === 'partial' ? Math.floor(Math.random() * 8) + 1 : 0),
    tasks_upserted: Math.floor(eventsProcessed * 0.4),
    time_entries_upserted: Math.floor(eventsProcessed * 0.55),
    triggered_by: RUN_TYPES[i % 3] === 'manual' ? ASSIGNEES[i % ASSIGNEES.length].name : 'system',
    error_message: status === 'failed' ? ['ClickUp API rate limit exceeded (429)', 'Connection reset by peer', 'Auth token expired — refresh required'][i % 3] : null,
  };
});

// Aliases — pages expect these names (with shape adjustments)
const ASSIGNEE_BY_ID = Object.fromEntries(ASSIGNEES.map(a => [a.id, a]));
const RATES = ASSIGNEE_RATES.map(r => ({
  ...r,
  id: r.rate_id,
  user_id: r.assignee_id,
  user: ASSIGNEE_BY_ID[r.assignee_id],
  effective_from: r.valid_from,
  effective_to: r.valid_to,
}));
const WEBHOOK_EVENTS = SYNC_LOGS;
const MISSING_RATES = MISSING_RATE_ISSUES;

// Enrich SPACES with derived counts/hours/cost so the Spaces page works
const ENRICHED_SPACES = SPACES.map((s, i) => {
  const tasks = TASKS.filter(t => t.space_id === s.id);
  const open = tasks.filter(t => t.status_type === 'open').length;
  const archived = tasks.filter(t => t.archived).length;
  const entries = TIME_ENTRIES.filter(te => te.space_id === s.id);
  const hours = entries.reduce((sum, e) => sum + e.duration_hours, 0);
  const billable = entries.filter(e => e.billable !== false).reduce((sum, e) => sum + e.duration_hours, 0);
  const cost = entries.reduce((sum, e) => sum + (e.cost_cents || 0), 0);
  const members = new Set(entries.map(e => e.user_id)).size || (3 + (i % 5));
  return {
    ...s,
    space_id: s.id,
    task_count: tasks.length,
    open_count: open,
    archived: i === SPACES.length - 1 && tasks.length === 0,
    synced: i !== 4, // one paused
    member_count: members,
    hours_logged: Math.round(hours * 10) / 10,
    billable_hours: Math.round(billable * 10) / 10,
    cost_cents: cost,
  };
});

Object.assign(window, {
  MOCK: {
    SPACES: ENRICHED_SPACES, ASSIGNEES, CLIENTS, DEPARTMENTS, STATUSES, PRIORITIES,
    TASKS, TIME_ENTRIES, ASSIGNEE_RATES, RATES,
    SYNC_LOGS, SYNC_RUNS, WEBHOOK_EVENTS,
    MISSING_RATE_ISSUES, MISSING_RATES, OVERVIEW_METRICS,
    SPRINTS, LISTS, FOLDERS,
  },
});
