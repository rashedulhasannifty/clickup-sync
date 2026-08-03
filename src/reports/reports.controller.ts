import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BudgetsService } from '../budgets/budgets.service';
import { SettingsService } from '../settings/settings.service';
import { TasksReportService } from './tasks-report.service';
import { TimeEntriesReportService } from './time-entries-report.service';
import { CostTrendReportService } from './cost-trend-report.service';
import { CycleTimeReportService } from './cycle-time-report.service';
import { AnomalyReportService } from './anomaly-report.service';
import { OpsReportService } from './ops-report.service';
import { SprintsReportService } from './sprints-report.service';

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
  ) {}

  @Get('tasks/summary')
  @ApiOperation({ summary: 'Task count summary by space and status' })
  tasksSummary() { return this.tasksReports.tasksSummary(); }

  @Get('tasks/by-space-status')
  @ApiOperation({ summary: 'Task counts grouped by space+status for stacked bar chart' })
  tasksBySpaceStatus() { return this.tasksReports.tasksBySpaceStatus(); }

  @Get('tasks/assignees')
  @ApiOperation({ summary: 'Distinct task assignees for the Tasks page filter dropdown. Drawn from clickup_tasks.assignees_names so assignees with zero time entries (e.g. expense-only tasks) still appear.' })
  tasksAssignees() { return this.tasksReports.tasksAssignees(); }

  @Get('time-entries/assignees')
  @ApiOperation({ summary: 'Distinct assignees that have time entries. Feeds the exclude-from-costing picker.' })
  timeEntriesAssignees() { return this.timeEntriesReports.timeEntriesAssignees(); }

  @Get('timesheet')
  @ApiOperation({ summary: 'Single-assignee timesheet: per-day, per-task hours + cost over [from, to]. userId is required; from/to default to the last 30 days.' })
  timesheet(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.timeEntriesReports.timesheet(userId, from, to);
  }

  @Get('clients')
  @ApiOperation({ summary: 'Distinct task clients for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks.client (non-empty, non-deleted), with per-client task counts.' })
  tasksClients() { return this.tasksReports.tasksClients(); }

  @Get('lists')
  @ApiOperation({ summary: 'Distinct ClickUp lists for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks (list_id/list_name, non-empty, non-deleted) with per-list task counts. Pass spaceId to scope to one space.' })
  tasksLists(@Query('spaceId') spaceId?: string) { return this.tasksReports.tasksLists(spaceId); }

  @Get('folders')
  @ApiOperation({ summary: 'Distinct ClickUp folders for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks (folder_id/folder_name, non-empty, non-deleted) with per-folder task counts. Pass spaceId to scope to one space.' })
  tasksFolders(@Query('spaceId') spaceId?: string) { return this.tasksReports.tasksFolders(spaceId); }

  @Get('tasks')
  @ApiOperation({ summary: 'Paginated task list with filters. `status`, `priority`, `assigneeId`, `client`, `listId` and `folderId` each accept a comma-separated list of values (OR semantics); a single value behaves exactly as before. `archived`: exclude (default, hide archived) | include | only (archived tasks). `sprintStatus=active|completed|all` (default `all`) scopes to tasks whose list (sprint) is/isn\'t archived. Soft-deleted rows are always excluded.' })
  tasks(
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
  ) {
    return this.tasksReports.tasks(spaceId, status, search, from, to, Number(limit) || 50, Number(offset) || 0, priority, assigneeId, type, archived, client, taskIds, listId, folderId, normalizeSprintStatus(sprintStatus, 'all'));
  }

  @Get('tasks/:taskId/description')
  @ApiOperation({ summary: 'Rich (markdown) + plain description for a single task. Fetched on demand by the task drawer; kept off the paged list/export payload on purpose.' })
  taskDescription(@Param('taskId') taskId: string) {
    return this.tasksReports.taskDescription(taskId);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Spend-spike anomalies for the Overview panel — daily totals and per-client weekly totals exceeding their median baselines.' })
  anomalies() {
    return this.anomalyReports.anomalies();
  }

  @Get('time-entries/hour-spikes')
  @ApiOperation({ summary: "Per-user daily-hour spikes: a team watchlist of days exceeding the absolute cap or 2x the user's median over the selected window (min 14 days), plus per-user daily-hours series for the chart. Supports limit + includeResolved." })
  hourSpikes(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('includeResolved') includeResolved?: string,
  ) {
    return this.anomalyReports.hourSpikes(this.settings.getSpikeHoursCap(), from, to, Number(limit) || 20, includeResolved === 'true', this.settings.isSpikeMedianEnabled());
  }

  @Get('time-entries/by-user')
  @ApiOperation({ summary: 'Total hours and cost per assignee' })
  timeEntriesByUser(@Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesByUser(from, to);
  }

  @Get('time-entries/by-client')
  @ApiOperation({ summary: 'Total hours and cost per client' })
  timeEntriesByClient(@Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesByClient(from, to);
  }

  @Get('time-entries/by-department')
  @ApiOperation({ summary: 'Total hours and cost per department' })
  timeEntriesByDepartment(@Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesByDepartment(from, to);
  }

  @Get('time-entries/billable-summary')
  @ApiOperation({ summary: 'Billable vs non-billable hours and cost' })
  timeEntriesBillableSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.timeEntriesBillableSummary(from, to);
  }

  @Get('time-entries/aggregates')
  @ApiOperation({ summary: 'Server-side aggregates for the Time Entries page metric cards. Accepts the same filters as /time-entries, including the same comma-separated multi-value support and `sprintStatus`.' })
  timeEntriesAggregates(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('billable') billable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
    @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string,
  ) {
    return this.timeEntriesReports.timeEntriesAggregates(userId, from, to, status, billable, search, spaceId, missingOnly, client, listId, folderId, archived, normalizeSprintStatus(sprintStatus, 'all'));
  }

  @Get('time-entries/cost-trend')
  @ApiOperation({ summary: 'Time-bucketed cost trend for the Overview chart. bucket=day|week|month; defaults vary by bucket if from/to are omitted.' })
  costTrend(
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.costTrendReports.costTrend(bucket, from, to);
  }

  @Get('time-entries/cost-trend-by-assignee')
  @ApiOperation({ summary: 'Time-bucketed labor cost split by assignee for the stacked Assignee cost trend chart. bucket=day|week|month; every assignee is returned as its own segment, ordered by total cost (highest first).' })
  costTrendByAssignee(
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.costTrendReports.costTrendByAssignee(bucket, from, to);
  }

  @Get('time-entries/cost-trend-by-client')
  @ApiOperation({ summary: 'Time-bucketed labor cost split by client for the stacked bar view of the Client cost trend chart. bucket=day|week|month; every client is returned as its own segment, ordered by total cost (highest first). Tasks with no client are grouped under "No client".' })
  costTrendByClient(
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.costTrendReports.costTrendByClient(bucket, from, to);
  }

  @Get('budgets/status')
  @ApiOperation({ summary: 'Per-client monthly budget vs actual + month-end forecast. ?month=YYYY-MM (defaults to current Dhaka month).' })
  budgetStatus(@Query('month') month?: string) {
    return this.budgets.clientBudgetStatus({ month });
  }

  @Get('overview-deltas')
  @ApiOperation({ summary: 'Current-period totals (hours, cost) and equal-length prior-period totals for the Overview KPI deltas.' })
  overviewDeltas(@Query('from') from?: string, @Query('to') to?: string) {
    return this.timeEntriesReports.overviewDeltas(from, to);
  }

  @Get('time-entries')
  @ApiOperation({ summary: 'Paginated time entry list (userId, from, to, status, billable, search, spaceId, missingOnly, client, listId, folderId, archived, sprintStatus). `userId`, `status`, `client`, `listId` and `folderId` each accept a comma-separated list of values (OR semantics); a single value behaves exactly as before. `missingOnly=true` overrides `status`. `archived` filters by the joined task: `exclude` (hide archived-task entries + keep task-less entries), `only`, or `include`/omitted (no constraint). `sprintStatus=active|completed|all` (default `all`) scopes to entries whose task\'s list (sprint) is/isn\'t archived, dropping task-less entries.' })
  timeEntriesList(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('billable') billable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
    @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string,
  ) {
    return this.timeEntriesReports.timeEntriesList(
      userId, from, to, status, Number(limit) || 50, Number(offset) || 0, billable, search, spaceId, missingOnly, client, listId, folderId, archived, normalizeSprintStatus(sprintStatus, 'all'),
    );
  }

  @Get('sprint-points')
  @ApiOperation({ summary: 'Sprint points by space and status' })
  sprintPoints(@Query('spaceId') spaceId?: string) {
    return this.tasksReports.sprintPoints(spaceId);
  }

  @Get('sprints')
  @ApiOperation({ summary: 'Paginated sprint (clickup_lists row) list with task/hours/cost roll-ups. `status=active|completed|all` (default `active`) filters by the list\'s archived flag. Optional spaceId/folderId scope, and a name search.' })
  sprints(
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
    });
  }

  // Static sub-paths of `sprints/*` MUST be declared before the `:listId`
  // param route below — Nest/Express match route segments in registration
  // order, so a `GET /sprints/folders` request would otherwise be captured
  // by `sprints/:listId` with `listId = 'folders'`.
  @Get('sprints/folders')
  @ApiOperation({ summary: 'Sprint (list) folders grouped with active/completed sprint counts, for the sprint folder-picker. Optional spaceId scope.' })
  sprintFolders(@Query('spaceId') spaceId?: string) {
    return this.sprintsReports.sprintFolders(spaceId);
  }

  @Get('sprints/velocity')
  @ApiOperation({ summary: 'Recent-sprint throughput (tasks done + hours logged) for a folder, most recent sprint first. folderId is required.' })
  velocity(@Query('folderId') folderId?: string, @Query('limit') limit?: string) {
    if (!folderId) {
      throw new BadRequestException('folderId is required');
    }
    return this.sprintsReports.velocity(folderId, Number(limit) || 12);
  }

  @Get('sprints/:listId')
  @ApiOperation({ summary: 'Single sprint (list) detail: status breakdown, per-assignee hours/cost, and mean cycle time for its tasks.' })
  sprintDetail(@Param('listId') listId: string) {
    return this.sprintsReports.sprintDetail(listId);
  }

  @Get('ops/sync-health')
  @ApiOperation({ summary: 'Sync checkpoint freshness per space (Fresh / Stale / Unknown)' })
  syncHealth() { return this.opsReports.syncHealth(); }

  @Get('ops/webhook-events')
  @ApiOperation({ summary: 'Recent webhook events with optional filters (status, eventType, search)' })
  webhookEvents(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('search') search?: string,
  ) {
    return this.opsReports.webhookEvents(Number(limit) || 50, Number(offset) || 0, status, eventType, search);
  }

  @Get('ops/job-logs')
  @ApiOperation({ summary: 'Sync job logs with optional filters (queueName, status)' })
  jobLogs(
    @Query('queueName') queueName?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.opsReports.jobLogs(queueName, status, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/dead-letters')
  @ApiOperation({ summary: 'Pending dead-letter jobs' })
  deadLetters(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.opsReports.deadLetters(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/stats')
  @ApiOperation({ summary: 'Dashboard overview stats (failures, dead-letters, webhooks, missing rates)' })
  stats() { return this.opsReports.stats([...this.settings.getExcludedAssigneeIds()]); }

  @Get('ops/missing-rates')
  @ApiOperation({ summary: 'Assignees with NO_RATE_FOUND time entries, grouped by user' })
  missingRates() { return this.opsReports.missingRates([...this.settings.getExcludedAssigneeIds()]); }

  @Get('spaces')
  @ApiOperation({ summary: 'Per-space task, hour, and cost aggregates' })
  spaces() { return this.tasksReports.spaces(); }

  @Get('cycle-time')
  @ApiOperation({ summary: 'Cycle-time aggregates (first open → last done) bucketed by week, client, or department.' })
  cycleTime(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const groupByVal = groupBy === 'client' || groupBy === 'department' ? groupBy : 'week';
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    return this.cycleTimeReports.cycleTime({ from: fromDate, to: toDate, groupBy: groupByVal });
  }

  @Get('time-in-status')
  @ApiOperation({ summary: 'Total hours each task spent in each status, over the window.' })
  timeInStatus(@Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    return this.cycleTimeReports.timeInStatus({ from: fromDate, to: toDate });
  }
}
