import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AccessScope } from '../access/access-scope';
import { requireUnrestricted, Scope } from '../access/scope.decorator';
import { BudgetsService } from '../budgets/budgets.service';
import { SettingsService } from '../settings/settings.service';
import { TasksReportService } from './tasks-report.service';
import { TimeEntriesReportService } from './time-entries-report.service';
import { CostTrendReportService } from './cost-trend-report.service';
import { CycleTimeReportService } from './cycle-time-report.service';
import { AnomalyReportService } from './anomaly-report.service';
import { OpsReportService } from './ops-report.service';
import { SprintsReportService } from './sprints-report.service';
import { WorkReportService, type WorkParams } from './work-report.service';
import { csvList } from './report-filter.util';
import { MAX_CHARGEABLE_TASK_IDS } from '../tasks/task-chargeability.constants';

/** `sprintStatus`/`status` filter accepted by the sprint routes and the
 *  tasks/time-entries list endpoints. Unrecognized values fall back to
 *  `fallback` rather than throwing — mirrors how `archived`/`groupBy` are
 *  validated elsewhere in this controller (silently ignored, not rejected). */
function normalizeSprintStatus(value: string | undefined, fallback: 'active' | 'all'): 'active' | 'completed' | 'all' {
  return value === 'active' || value === 'completed' || value === 'all' ? value : fallback;
}

@ApiTags('reports')
@ApiSecurity('x-admin-key')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly tasksReports: TasksReportService,
    private readonly timeEntriesReports: TimeEntriesReportService,
    private readonly costTrendReports: CostTrendReportService,
    private readonly cycleTimeReports: CycleTimeReportService,
    private readonly anomalyReports: AnomalyReportService,
    private readonly opsReports: OpsReportService,
    private readonly settings: SettingsService,
    private readonly budgets: BudgetsService,
    private readonly sprintsReports: SprintsReportService,
    private readonly workReports: WorkReportService,
  ) {}

  @Get('tasks/summary')
  @ApiOperation({ summary: 'Task count summary by space and status' })
  tasksSummary(@Scope() scope: AccessScope) { return this.tasksReports.tasksSummary(scope); }

  @Get('tasks/by-space-status')
  @ApiOperation({ summary: 'Task counts grouped by space+status for stacked bar chart' })
  tasksBySpaceStatus(@Scope() scope: AccessScope) { return this.tasksReports.tasksBySpaceStatus(scope); }

  @Get('tasks/assignees')
  @ApiOperation({ summary: 'Distinct task assignees for the Tasks page filter dropdown. Drawn from clickup_tasks.assignees_names so assignees with zero time entries (e.g. expense-only tasks) still appear.' })
  tasksAssignees(@Scope() scope: AccessScope) { return this.tasksReports.tasksAssignees(scope); }

  @Get('time-entries/assignees')
  @ApiOperation({ summary: 'Distinct assignees that have time entries. Feeds the exclude-from-costing picker and the timesheet picker.' })
  timeEntriesAssignees(@Scope() scope: AccessScope) { return this.timeEntriesReports.timeEntriesAssignees(scope); }

  @Get('timesheet')
  @ApiOperation({ summary: 'Single-assignee timesheet: per-day, per-task hours + cost over [from, to]. userId is required; from/to default to the last 30 days. Access: the viewer must lead userId\'s team, or be userId themself. NOT client-filtered (decision 10) — rows from a client the viewer doesn\'t lead still appear, with cost masked.' })
  timesheet(
    @Scope() scope: AccessScope,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.timeEntriesReports.timesheet(userId, from, to, scope);
  }

  @Get('clients')
  @ApiOperation({ summary: 'Distinct task clients for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks.client (non-empty, non-deleted), with per-client task counts. `spaceId`, `from`/`to` (on updated_date) and `archived` scope the counts the same way `/reports/tasks` does, so the number in the dropdown label matches the number of rows the table will show. Omit them all for the workspace-wide list (what Budgets wants).' })
  tasksClients(
    @Scope() scope: AccessScope,
    @Query('spaceId') spaceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ) {
    return this.tasksReports.tasksClients({ spaceId, from, to, archived }, scope);
  }

  @Get('sub-projects')
  @ApiOperation({ summary: 'Distinct task sub-projects (ClickUp "Sub-Project" labels field) for the Tasks and Time Entries page filter dropdowns, with per-option task counts. Scoped by `spaceId`, `from`/`to` (on updated_date) and `archived` exactly like `/reports/clients`. A task can carry several sub-projects, so the counts can sum to more than the task total.' })
  tasksSubProjects(
    @Scope() scope: AccessScope,
    @Query('spaceId') spaceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ) {
    return this.tasksReports.tasksSubProjects({ spaceId, from, to, archived }, scope);
  }

  @Get('lists')
  @ApiOperation({ summary: 'Distinct ClickUp lists for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks (list_id/list_name, non-empty, non-deleted) with per-list task counts. Pass spaceId to scope to one space.' })
  tasksLists(@Scope() scope: AccessScope, @Query('spaceId') spaceId?: string) {
    return this.tasksReports.tasksLists(spaceId, scope);
  }

  @Get('folders')
  @ApiOperation({ summary: 'Distinct ClickUp folders for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks (folder_id/folder_name, non-empty, non-deleted) with per-folder task counts. Pass spaceId to scope to one space.' })
  tasksFolders(@Scope() scope: AccessScope, @Query('spaceId') spaceId?: string) {
    return this.tasksReports.tasksFolders(spaceId, scope);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Paginated task list with filters. `status`, `priority`, `assigneeId`, `client`, `listId` and `folderId` each accept a comma-separated list of values (OR semantics); a single value behaves exactly as before. `archived`: exclude (default, hide archived) | include | only (archived tasks). `sprintStatus=active|completed|all` (default `all`) scopes to tasks whose list (sprint) is/isn\'t archived. `chargeable=true|false|partial` filters on the task flag together with its (task, assignee) rules: `partial` means a rule disagrees with the flag, `true`/`false` mean the flag with no such rule. The three are mutually exclusive. Soft-deleted rows are always excluded.' })
  tasks(
    @Scope() scope: AccessScope,
    @Query('spaceId') spaceId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('priority') priority?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('type') type?: string,
    @Query('archived') archived?: string,
    @Query('client') client?: string,
    @Query('taskIds') taskIds?: string,
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
    @Query('sprintStatus') sprintStatus?: string,
    @Query('chargeable') chargeable?: string,
    @Query('subProject') subProject?: string,
  ) {
    return this.tasksReports.tasks(scope, spaceId, status, search, from, to, Number(limit) || 50, Number(offset) || 0, priority, assigneeId, type, archived, client, taskIds, listId, folderId, normalizeSprintStatus(sprintStatus, 'all'), chargeable, subProject);
  }

  @Get('tasks/:taskId/description')
  @ApiOperation({ summary: 'Rich (markdown) + plain description for a single task. Fetched on demand by the task drawer; kept off the paged list/export payload on purpose.' })
  taskDescription(@Param('taskId') taskId: string, @Scope() scope: AccessScope) {
    return this.tasksReports.taskDescription(taskId, scope);
  }

  @Get('tasks/:taskId/assignee-chargeability')
  @ApiOperation({ summary: "Everyone who logged time on one task, with hours, the (task, assignee) rule if any, the resolved chargeability, and which layer decided it ('assignee' | 'task' | 'default'). Backs the task drawer's per-assignee controls." })
  taskAssigneeChargeability(@Param('taskId') taskId: string, @Scope() scope: AccessScope) {
    return this.timeEntriesReports.taskAssigneeChargeability(taskId, scope);
  }

  @Get('tasks/chargeable-preview')
  @ApiOperation({ summary: 'Counts behind the chargeability confirmation dialog: tasks given, tasks that would actually change, and the time entries + hours affected. `taskIds` is a comma-separated list, max 500.' })
  chargeablePreview(
    @Scope() scope: AccessScope,
    @Query('taskIds') taskIds = '',
    @Query('chargeable') chargeable?: string,
  ) {
    const ids = csvList(taskIds) ?? [];
    if (ids.length === 0) throw new BadRequestException('taskIds is required');
    if (ids.length > MAX_CHARGEABLE_TASK_IDS) throw new BadRequestException(`At most ${MAX_CHARGEABLE_TASK_IDS} tasks per request`);
    return this.tasksReports.chargeablePreview(ids, chargeable === 'true', scope);
  }

  // Ops/anomaly/spike routes are admin-grade data, but a plain @Roles(OWNER, ADMIN)
  // would 403 a MEMBER even with team scoping OFF — and NotificationCenter (rendered
  // for every role) calls this, anomalies and hour-spikes today. requireUnrestricted
  // reproduces flag-off behaviour exactly (a flag-off MEMBER's scope is 'unrestricted')
  // while still 403ing a scoped MEMBER once scoping is on. See Ruling R8.
  @Get('anomalies')
  @ApiOperation({ summary: 'Spend-spike anomalies for the Overview panel — daily totals and per-client weekly totals exceeding their median baselines.' })
  anomalies(@Scope() scope: AccessScope) {
    requireUnrestricted(scope);
    return this.anomalyReports.anomalies();
  }

  @Get('time-entries/hour-spikes')
  @ApiOperation({ summary: "Per-user daily-hour spikes: a team watchlist of days exceeding the absolute cap or 2x the user's median over the selected window (min 14 days), plus per-user daily-hours series for the chart. Supports limit + includeResolved." })
  hourSpikes(
    @Scope() scope: AccessScope,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('includeResolved') includeResolved?: string,
  ) {
    requireUnrestricted(scope);
    return this.anomalyReports.hourSpikes(this.settings.getSpikeHoursCap(), from, to, Number(limit) || 20, includeResolved === 'true', this.settings.isSpikeMedianEnabled());
  }

  @Get('time-entries/by-user')
  @ApiOperation({ summary: 'Total hours and cost per assignee' })
  timeEntriesByUser(@Scope() scope: AccessScope, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesByUser(scope, from, to);
  }

  @Get('time-entries/by-client')
  @ApiOperation({ summary: 'Total hours and cost per client' })
  timeEntriesByClient(@Scope() scope: AccessScope, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesByClient(scope, from, to);
  }

  @Get('time-entries/by-department')
  @ApiOperation({ summary: 'Total hours and cost per department' })
  timeEntriesByDepartment(@Scope() scope: AccessScope, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesByDepartment(scope, from, to);
  }

  @Get('time-entries/chargeable-summary')
  @ApiOperation({ summary: 'Chargeable vs non-chargeable hours' })
  timeEntriesChargeableSummary(@Scope() scope: AccessScope, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesChargeableSummary(scope, from, to);
  }

  @Get('time-entries/aggregates')
  @ApiOperation({ summary: 'Server-side aggregates for the Time Entries page metric cards. Accepts the same filters as /time-entries, including the same comma-separated multi-value support and `sprintStatus`.' })
  timeEntriesAggregates(
    @Scope() scope: AccessScope,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('chargeable') chargeable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
    @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string,
    @Query('subProject') subProject?: string,
  ) {
    return this.timeEntriesReports.timeEntriesAggregates(scope, userId, from, to, status, chargeable, search, spaceId, missingOnly, client, listId, folderId, archived, normalizeSprintStatus(sprintStatus, 'all'), subProject);
  }

  @Get('time-entries/cost-trend')
  @ApiOperation({ summary: 'Time-bucketed cost trend for the Overview chart. bucket=day|week|month; defaults vary by bucket if from/to are omitted. Lead-only: scoped to the viewer\'s LEAD clients.' })
  costTrend(
    @Scope() scope: AccessScope,
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.costTrendReports.costTrend(scope, bucket, from, to);
  }

  @Get('time-entries/cost-trend-by-assignee')
  @ApiOperation({ summary: 'Time-bucketed labor cost split by assignee for the stacked Assignee cost trend chart. bucket=day|week|month; every assignee is returned as its own segment, ordered by total cost (highest first). Lead-only: scoped to the viewer\'s LEAD clients.' })
  costTrendByAssignee(
    @Scope() scope: AccessScope,
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.costTrendReports.costTrendByAssignee(scope, bucket, from, to);
  }

  @Get('time-entries/cost-trend-by-client')
  @ApiOperation({ summary: 'Time-bucketed labor cost split by client for the stacked bar view of the Client cost trend chart. bucket=day|week|month; every client is returned as its own segment, ordered by total cost (highest first). Tasks with no client are grouped under "No client". Lead-only: scoped to the viewer\'s LEAD clients.' })
  costTrendByClient(
    @Scope() scope: AccessScope,
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.costTrendReports.costTrendByClient(scope, bucket, from, to);
  }

  @Get('budgets/status')
  @ApiOperation({ summary: 'Per-client monthly budget vs actual + month-end forecast. ?month=YYYY-MM (defaults to current Dhaka month). Lead-only: scoped to the viewer\'s LEAD clients.' })
  budgetStatus(@Scope() scope: AccessScope, @Query('month') month?: string) {
    return this.budgets.clientBudgetStatus({ month, scope });
  }

  // The lead-view gate (Ruling R1: requireLeadView, not requireLead) lives in
  // TimeEntriesReportService.overviewDeltas itself, not here — this handler is
  // a thin passthrough.
  @Get('overview-deltas')
  @ApiOperation({ summary: 'Current-period totals (hours, cost) and equal-length prior-period totals for the Overview KPI deltas.' })
  overviewDeltas(@Scope() scope: AccessScope, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.overviewDeltas(scope, from, to);
  }

  @Get('time-entries/by-task')
  @ApiOperation({ summary: 'The time entry list grouped by task: one row per task with summed hours, valid cost, entry count and distinct assignees. Accepts exactly the same filters as /time-entries (same comma-separated multi-value support), so a row\'s total always equals the sum of the entries /time-entries returns for the same filters plus `taskId`. `total` is the number of TASKS, not entries. Entries with no task are grouped under the synthetic task id `__none__`. Cost sums only entries that have a rate — `missingRateCount` reports how many did not.' })
  timeEntriesByTask(
    @Scope() scope: AccessScope,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('chargeable') chargeable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
    @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string,
    @Query('subProject') subProject?: string,
  ) {
    return this.timeEntriesReports.timeEntriesByTask({
      userId, from, to, status, limit: Number(limit) || 50, offset: Number(offset) || 0,
      chargeable, search, spaceId, missingOnly, client, subProject, listId, folderId, archived,
      sprintStatus: normalizeSprintStatus(sprintStatus, 'all'),
      scope,
    });
  }

  @Get('time-entries')
  @ApiOperation({ summary: 'Paginated time entry list (userId, from, to, status, chargeable, search, spaceId, missingOnly, client, listId, folderId, archived, sprintStatus). `userId`, `status`, `client`, `listId` and `folderId` each accept a comma-separated list of values (OR semantics); a single value behaves exactly as before. `missingOnly=true` overrides `status`. `archived` filters by the joined task: `exclude` (hide archived-task entries + keep task-less entries), `only`, or `include`/omitted (no constraint). `sprintStatus=active|completed|all` (default `all`) scopes to entries whose task\'s list (sprint) is/isn\'t archived, dropping task-less entries. `taskId` matches one task exactly (use `__none__` for entries with no task) — this is how the grouped view expands a row. `chargeable=true|false` filters on each entry\'s own resolved chargeability; entries with no task default to chargeable.' })
  timeEntriesList(
    @Scope() scope: AccessScope,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('chargeable') chargeable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
    @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string,
    @Query('taskId') taskId?: string,
    @Query('subProject') subProject?: string,
  ) {
    return this.timeEntriesReports.timeEntriesList(
      scope, userId, from, to, status, Number(limit) || 50, Number(offset) || 0, chargeable, search, spaceId, missingOnly, client, listId, folderId, archived, normalizeSprintStatus(sprintStatus, 'all'), taskId, subProject,
    );
  }

  @Get('sprint-points')
  @ApiOperation({ summary: 'Sprint points by space and status' })
  sprintPoints(@Scope() scope: AccessScope, @Query('spaceId') spaceId?: string) {
    return this.tasksReports.sprintPoints(spaceId, scope);
  }

  @Get('sprints')
  @ApiOperation({ summary: 'Paginated sprint (clickup_lists row) list with task/hours/cost roll-ups. `status=active|completed|all` (default `active`) filters by the list\'s archived flag. Optional spaceId/folderId scope, and a name search. Lead-only view: 403s a scoped viewer who leads no team.' })
  sprints(
    @Scope() scope: AccessScope,
    @Query('spaceId') spaceId?: string,
    @Query('folderId') folderId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.sprintsReports.sprints({
      spaceId,
      folderId,
      status: normalizeSprintStatus(status, 'active'),
      search,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    }, scope);
  }

  // Static sub-paths of `sprints/*` MUST be declared before the `:listId`
  // param route below — Nest/Express match route segments in registration
  // order, so a `GET /sprints/folders` request would otherwise be captured
  // by `sprints/:listId` with `listId = 'folders'`.
  @Get('sprints/folders')
  @ApiOperation({ summary: 'Sprint (list) folders grouped with active/completed sprint counts, for the sprint folder-picker. Optional spaceId scope. Lead-only view: 403s a scoped viewer who leads no team.' })
  sprintFolders(@Scope() scope: AccessScope, @Query('spaceId') spaceId?: string) {
    return this.sprintsReports.sprintFolders(spaceId, scope);
  }

  @Get('sprints/velocity')
  @ApiOperation({ summary: 'Recent-sprint throughput (tasks done + hours logged) for a folder, most recent sprint first. folderId is required. Lead-only view: 403s a scoped viewer who leads no team.' })
  velocity(@Scope() scope: AccessScope, @Query('folderId') folderId?: string, @Query('limit') limit?: string) {
    if (!folderId) {
      throw new BadRequestException('folderId is required');
    }
    return this.sprintsReports.velocity(folderId, Number(limit) || 12, scope);
  }

  @Get('sprints/:listId')
  @ApiOperation({ summary: 'Single sprint (list) detail: status breakdown, per-assignee hours/cost, and mean cycle time for its tasks. Lead-only view: 403s a scoped viewer who leads no team.' })
  sprintDetail(@Param('listId') listId: string, @Scope() scope: AccessScope) {
    return this.sprintsReports.sprintDetail(listId, scope);
  }

  @Get('ops/sync-health')
  @ApiOperation({ summary: 'Sync checkpoint freshness per space (Fresh / Stale / Unknown)' })
  syncHealth(@Scope() scope: AccessScope) {
    requireUnrestricted(scope);
    return this.opsReports.syncHealth();
  }

  @Get('ops/webhook-events')
  @ApiOperation({ summary: 'Recent webhook events with optional filters (status, eventType, search)' })
  webhookEvents(
    @Scope() scope: AccessScope,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('search') search?: string,
  ) {
    requireUnrestricted(scope);
    return this.opsReports.webhookEvents(Number(limit) || 50, Number(offset) || 0, status, eventType, search);
  }

  @Get('ops/job-logs')
  @ApiOperation({ summary: 'Sync job logs with optional filters (queueName, status)' })
  jobLogs(
    @Scope() scope: AccessScope,
    @Query('queueName') queueName?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    requireUnrestricted(scope);
    return this.opsReports.jobLogs(queueName, status, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/dead-letters')
  @ApiOperation({ summary: 'Pending dead-letter jobs' })
  deadLetters(@Scope() scope: AccessScope, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    requireUnrestricted(scope);
    return this.opsReports.deadLetters(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/stats')
  @ApiOperation({ summary: 'Dashboard overview stats (failures, dead-letters, webhooks, missing rates)' })
  stats(@Scope() scope: AccessScope) {
    requireUnrestricted(scope);
    return this.opsReports.stats([...this.settings.getExcludedAssigneeIds()]);
  }

  @Get('ops/missing-rates')
  @ApiOperation({ summary: 'Assignees with NO_RATE_FOUND time entries, grouped by user' })
  missingRates(@Scope() scope: AccessScope) {
    requireUnrestricted(scope);
    return this.opsReports.missingRates([...this.settings.getExcludedAssigneeIds()]);
  }

  @Get('spaces')
  @ApiOperation({ summary: 'Per-space task, hour, and cost aggregates' })
  spaces(@Scope() scope: AccessScope) { return this.tasksReports.spaces(scope); }

  @Get('cycle-time')
  @ApiOperation({ summary: 'Cycle-time aggregates (first open → last done) bucketed by week, client, or department. Scoped to in-scope tasks; not lead-gated.' })
  cycleTime(
    @Scope() scope: AccessScope,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const groupByVal = groupBy === 'client' || groupBy === 'department' ? groupBy : 'week';
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    return this.cycleTimeReports.cycleTime({ from: fromDate, to: toDate, groupBy: groupByVal }, scope);
  }

  @Get('time-in-status')
  @ApiOperation({ summary: 'Total hours each task spent in each status, over the window. Scoped to in-scope tasks; not lead-gated.' })
  timeInStatus(@Scope() scope: AccessScope, @Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    return this.cycleTimeReports.timeInStatus({ from: fromDate, to: toDate }, scope);
  }

  /** Both /work routes take the same params; one mapper keeps them identical. */
  private static workParams(
    scope: AccessScope,
    from?: string, to?: string, spaceId?: string, search?: string, status?: string, priority?: string,
    type?: string, assignedTo?: string, loggedBy?: string, costStatus?: string, missingOnly?: string,
    client?: string, subProject?: string, listId?: string, folderId?: string, archived?: string,
    sprintStatus?: string, chargeable?: string, sort?: string, dir?: string, limit?: string, offset?: string,
  ): WorkParams {
    return {
      from, to, spaceId, search, status, priority, type, assignedTo, loggedBy, costStatus, missingOnly,
      client, subProject, listId, folderId, archived,
      sprintStatus: normalizeSprintStatus(sprintStatus, 'all'),
      chargeable, sort, dir,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
      scope,
    };
  }

  @Get('work')
  @ApiOperation({ summary: 'The Tasks & time (/work) page: every task with activity in [from, to] — updated in range OR with time logged in range — each carrying the in-range time on it (`logged`, null when none). Task filters (status, priority, type, assignedTo=task assignee names, search) choose rows. Entry filters (loggedBy=entry userIds, costStatus, missingOnly) choose which entries are counted and hide tasks left with none. Task attributes (client, subProject, listId, folderId, archived — default include, sprintStatus) apply to both. `chargeable=true|false|partial` filters on the row pill before paging. `sort=logged|updated|name|cost|lastActivity` (default logged), `dir=asc|desc` (default desc). `totals` sums every matching row, not the page. Entries with no task appear as `__none__` only when no task filter is set.' })
  work(
    @Scope() scope: AccessScope,
    @Query('from') from?: string, @Query('to') to?: string, @Query('spaceId') spaceId?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string,
    @Query('type') type?: string, @Query('assignedTo') assignedTo?: string, @Query('loggedBy') loggedBy?: string,
    @Query('costStatus') costStatus?: string, @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string, @Query('subProject') subProject?: string, @Query('listId') listId?: string,
    @Query('folderId') folderId?: string, @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string, @Query('chargeable') chargeable?: string,
    @Query('sort') sort?: string, @Query('dir') dir?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.workReports.work(ReportsController.workParams(
      scope, from, to, spaceId, search, status, priority, type, assignedTo, loggedBy, costStatus, missingOnly,
      client, subProject, listId, folderId, archived, sprintStatus, chargeable, sort, dir, limit, offset,
    ));
  }

  @Get('work/entries')
  @ApiOperation({ summary: 'Every counted time entry behind the rows /reports/work lists for the same params (used by the two-sheet export). Newest first, capped at 5000: over the cap it returns no items and `truncated: true` rather than a partial list, so an export can never disagree with its Tasks sheet.' })
  workEntries(
    @Scope() scope: AccessScope,
    @Query('from') from?: string, @Query('to') to?: string, @Query('spaceId') spaceId?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string,
    @Query('type') type?: string, @Query('assignedTo') assignedTo?: string, @Query('loggedBy') loggedBy?: string,
    @Query('costStatus') costStatus?: string, @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string, @Query('subProject') subProject?: string, @Query('listId') listId?: string,
    @Query('folderId') folderId?: string, @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string, @Query('chargeable') chargeable?: string,
    @Query('sort') sort?: string, @Query('dir') dir?: string,
  ) {
    return this.workReports.workEntries(ReportsController.workParams(
      scope,
      from, to, spaceId, search, status, priority, type, assignedTo, loggedBy, costStatus, missingOnly,
      client, subProject, listId, folderId, archived, sprintStatus, chargeable, sort, dir, undefined, undefined,
    ));
  }
}
