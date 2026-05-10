import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../admin/admin-api-key.guard';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiSecurity('x-admin-key')
@UseGuards(AdminApiKeyGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('tasks/summary')
  @ApiOperation({ summary: 'Task count summary by space and status' })
  tasksSummary() { return this.reports.tasksSummary(); }

  @Get('tasks/by-space-status')
  @ApiOperation({ summary: 'Task counts grouped by space+status for stacked bar chart' })
  tasksBySpaceStatus() { return this.reports.tasksBySpaceStatus(); }

  @Get('tasks')
  @ApiOperation({ summary: 'Paginated task list with filters (spaceId, status, search, from, to)' })
  tasks(
    @Query('spaceId') spaceId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reports.tasks(spaceId, status, search, from, to, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('time-entries/by-user')
  @ApiOperation({ summary: 'Total hours and cost per assignee' })
  timeEntriesByUser(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.timeEntriesByUser(from, to);
  }

  @Get('time-entries/by-client')
  @ApiOperation({ summary: 'Total hours and cost per client' })
  timeEntriesByClient(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.timeEntriesByClient(from, to);
  }

  @Get('time-entries/by-department')
  @ApiOperation({ summary: 'Total hours and cost per department' })
  timeEntriesByDepartment(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.timeEntriesByDepartment(from, to);
  }

  @Get('time-entries/billable-summary')
  @ApiOperation({ summary: 'Billable vs non-billable hours and cost' })
  timeEntriesBillableSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.timeEntriesBillableSummary(from, to);
  }

  @Get('time-entries')
  @ApiOperation({ summary: 'Paginated time entry list with filters (userId, from, to, status)' })
  timeEntriesList(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reports.timeEntriesList(userId, from, to, status, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('sprint-points')
  @ApiOperation({ summary: 'Sprint points by space and status' })
  sprintPoints(@Query('spaceId') spaceId?: string) {
    return this.reports.sprintPoints(spaceId);
  }

  @Get('ops/sync-health')
  @ApiOperation({ summary: 'Sync checkpoint freshness per space (Fresh / Stale / Unknown)' })
  syncHealth() { return this.reports.syncHealth(); }

  @Get('ops/webhook-events')
  @ApiOperation({ summary: 'Recent webhook events' })
  webhookEvents(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.reports.webhookEvents(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/job-logs')
  @ApiOperation({ summary: 'Sync job logs with optional filters (queueName, status)' })
  jobLogs(
    @Query('queueName') queueName?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reports.jobLogs(queueName, status, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/dead-letters')
  @ApiOperation({ summary: 'Pending dead-letter jobs' })
  deadLetters(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.reports.deadLetters(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('ops/stats')
  @ApiOperation({ summary: 'Dashboard overview stats (failures, dead-letters, webhooks, missing rates)' })
  stats() { return this.reports.stats(); }
}
