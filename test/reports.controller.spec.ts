import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { resolveScope } from '../src/access/access-scope';
import { SCOPE_PARAM } from '../src/access/scope.decorator';
import { ReportsController } from '../src/reports/reports.controller';
import { TasksReportService } from '../src/reports/tasks-report.service';
import { TimeEntriesReportService } from '../src/reports/time-entries-report.service';
import { CostTrendReportService } from '../src/reports/cost-trend-report.service';
import { CycleTimeReportService } from '../src/reports/cycle-time-report.service';
import { AnomalyReportService } from '../src/reports/anomaly-report.service';
import { OpsReportService } from '../src/reports/ops-report.service';
import { SettingsService } from '../src/settings/settings.service';
import { BudgetsService } from '../src/budgets/budgets.service';
import { SprintsReportService } from '../src/reports/sprints-report.service';
import { WorkReportService } from '../src/reports/work-report.service';

describe('ReportsController', () => {
  // Build a controller wiring the report sub-services + settings + budgets.
  // Each `over` key replaces one collaborator; the rest are inert stubs. Keeps
  // call sites short and resilient to the constructor arg order.
  function makeCtrl(over: Partial<{
    tasks: any; timeEntries: any; costTrend: any; cycleTime: any; anomaly: any; ops: any; settings: any; budgets: any; sprints: any; work: any;
  }> = {}) {
    return new ReportsController(
      over.tasks ?? {},
      over.timeEntries ?? {},
      over.costTrend ?? { costTrend: jest.fn().mockResolvedValue([]) },
      over.cycleTime ?? {},
      over.anomaly ?? {},
      over.ops ?? {},
      over.settings ?? makeSettings(),
      over.budgets ?? makeBudgets(),
      over.sprints ?? makeSprints(),
      over.work ?? {},
    );
  }

  function makeSprints() {
    return {
      sprints: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      sprintFolders: jest.fn().mockResolvedValue([]),
      velocity: jest.fn().mockResolvedValue([]),
      sprintDetail: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeSettings(cap = 12, medianEnabled = true) {
    return {
      getSpikeHoursCap: jest.fn().mockReturnValue(cap),
      isSpikeMedianEnabled: jest.fn().mockReturnValue(medianEnabled),
      // Read by `stats`/`missingRates` (ops routes) to exclude assignees.
      getExcludedAssigneeIds: jest.fn().mockReturnValue([]),
    } as any;
  }

  function makeBudgets() {
    return { clientBudgetStatus: jest.fn().mockResolvedValue([]) } as any;
  }

  // Scopes for the ops/anomaly/spike routes (Ruling R8): requireUnrestricted() must let
  // an OWNER/ADMIN and a flag-off MEMBER through (flag-off parity) but 403 a scoped MEMBER.
  const OWNER_SCOPE = resolveScope({
    role: 'OWNER', scopingEnabled: true, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [],
  });
  const FLAG_OFF_MEMBER_SCOPE = resolveScope({
    role: 'MEMBER', scopingEnabled: false, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [],
  });
  const SCOPED_MEMBER_SCOPE = resolveScope({
    role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
    memberships: [{ teamId: 'A', role: 'MEMBER' }], teamClients: [], teamMembers: [],
  });

  describe('overviewDeltas', () => {
    function makeTimeEntriesWithDeltas() {
      return {
        overviewDeltas: jest.fn().mockResolvedValue({
          current: { totalHours: 10, totalCostAud: 1000 },
          prior:   { totalHours: 8,  totalCostAud: 800 },
        }),
      } as any;
    }

    it('passes scope + from/to through to the service', async () => {
      const timeEntries = makeTimeEntriesWithDeltas();
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.overviewDeltas(OWNER_SCOPE, '2026-05-01', '2026-05-31');
      expect(timeEntries.overviewDeltas).toHaveBeenCalledWith(OWNER_SCOPE, '2026-05-01', '2026-05-31');
    });

    it('returns the service result unchanged', async () => {
      const timeEntries = makeTimeEntriesWithDeltas();
      const ctrl = makeCtrl({ timeEntries });
      const result = await ctrl.overviewDeltas(OWNER_SCOPE);
      expect(result).toEqual({
        current: { totalHours: 10, totalCostAud: 1000 },
        prior:   { totalHours: 8,  totalCostAud: 800 },
      });
    });

    // Fix round 1 (R15): the requireLeadView gate moved into
    // TimeEntriesReportService.overviewDeltas itself — this controller
    // handler is a thin passthrough with no gating of its own. The
    // Forbidden/flag-off-allowed coverage now lives in
    // test/time-entries-report.service.spec.ts ('overviewDeltas (access scope)').
  });

  describe('anomalies', () => {
    it('returns the service result unchanged', async () => {
      const anomaly = {
        anomalies: jest.fn().mockResolvedValue({
          dailySpikes: [{ date: '2026-05-04', totalCostAud: 1920, medianAud: 456, multiplier: 4.21 }],
          clientSpikes: [],
        }),
      } as any;
      const ctrl = makeCtrl({ anomaly });
      const result = await ctrl.anomalies(OWNER_SCOPE);
      expect(anomaly.anomalies).toHaveBeenCalledTimes(1);
      expect(result.dailySpikes).toHaveLength(1);
      expect(result.clientSpikes).toEqual([]);
    });

    it('scoped MEMBER (Ruling R8): throws ForbiddenException, service not called', () => {
      const anomaly = { anomalies: jest.fn() } as any;
      const ctrl = makeCtrl({ anomaly });
      expect(() => ctrl.anomalies(SCOPED_MEMBER_SCOPE)).toThrow(ForbiddenException);
      expect(anomaly.anomalies).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER (Ruling R8): reproduces today exactly — service is called', async () => {
      const anomaly = { anomalies: jest.fn().mockResolvedValue({ dailySpikes: [], clientSpikes: [] }) } as any;
      const ctrl = makeCtrl({ anomaly });
      await ctrl.anomalies(FLAG_OFF_MEMBER_SCOPE);
      expect(anomaly.anomalies).toHaveBeenCalledTimes(1);
    });
  });

  describe('costTrend', () => {
    // requireLeadView() lives in CostTrendReportService.costTrend itself — this
    // controller handler is a thin passthrough with no gating of its own, same
    // pattern as overviewDeltas above.
    it('passes scope + bucket + from + to through to the service for valid bucket', async () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      await ctrl.costTrend(OWNER_SCOPE, 'day', '2026-05-01', '2026-05-21');
      expect(costTrend.costTrend).toHaveBeenCalledWith(OWNER_SCOPE, 'day', '2026-05-01', '2026-05-21');
    });

    it('rejects bucket="hour" with BadRequestException', () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      expect(() => ctrl.costTrend(OWNER_SCOPE, 'hour' as any)).toThrow(BadRequestException);
      expect(costTrend.costTrend).not.toHaveBeenCalled();
    });

    it('rejects missing bucket', () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      expect(() => ctrl.costTrend(OWNER_SCOPE, undefined as any)).toThrow(BadRequestException);
      expect(costTrend.costTrend).not.toHaveBeenCalled();
    });

    it.each(['day', 'week', 'month'] as const)('accepts bucket=%s', async (b) => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      await ctrl.costTrend(OWNER_SCOPE, b);
      expect(costTrend.costTrend).toHaveBeenCalledWith(OWNER_SCOPE, b, undefined, undefined);
    });
  });

  describe('hourSpikes', () => {
    it('passes the settings cap + from/to into the service with default limit/includeResolved', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = makeCtrl({ anomaly, settings });
      const result = await ctrl.hourSpikes(OWNER_SCOPE, '2026-06-01', '2026-06-10');
      expect(settings.getSpikeHoursCap).toHaveBeenCalledTimes(1);
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, true);
      expect(result.cap).toBe(10);
    });

    it('passes the cap, range, limit and includeResolved through', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = makeCtrl({ anomaly, settings });
      await ctrl.hourSpikes(OWNER_SCOPE, '2026-06-01', '2026-06-10', '40', 'true');
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 40, true, true);
    });

    it('forwards medianEnabled=false from settings into the service', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const ctrl = makeCtrl({ anomaly, settings: makeSettings(10, false) });
      await ctrl.hourSpikes(OWNER_SCOPE, '2026-06-01', '2026-06-10');
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, false);
    });

    it('scoped MEMBER (Ruling R8): throws ForbiddenException, service not called', () => {
      const anomaly = { hourSpikes: jest.fn() } as any;
      const ctrl = makeCtrl({ anomaly });
      expect(() => ctrl.hourSpikes(SCOPED_MEMBER_SCOPE, '2026-06-01', '2026-06-10')).toThrow(ForbiddenException);
      expect(anomaly.hourSpikes).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER (Ruling R8): reproduces today exactly — service is called', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const ctrl = makeCtrl({ anomaly, settings: makeSettings(10) });
      await ctrl.hourSpikes(FLAG_OFF_MEMBER_SCOPE, '2026-06-01', '2026-06-10');
      expect(anomaly.hourSpikes).toHaveBeenCalledTimes(1);
    });
  });

  // Whole-branch review item 2: every ops/anomaly/spike route (per the spec's
  // "Ops, anomaly and hour-spike reports stay Owner/Admin only" default) must
  // 403 a scoped MEMBER and behave exactly like today for a flag-off MEMBER
  // (Ruling R8). One parametrised table covers all 8 routes so a new one
  // added here without `requireUnrestricted()` fails the same way.
  describe('ops-route access gate (all 8 admin-grade routes)', () => {
    it.each([
      ['anomalies', 'anomaly', 'anomalies', (ctrl: ReportsController, scope: any) => ctrl.anomalies(scope)],
      ['hourSpikes', 'anomaly', 'hourSpikes', (ctrl: ReportsController, scope: any) => ctrl.hourSpikes(scope)],
      ['syncHealth', 'ops', 'syncHealth', (ctrl: ReportsController, scope: any) => ctrl.syncHealth(scope)],
      ['webhookEvents', 'ops', 'webhookEvents', (ctrl: ReportsController, scope: any) => ctrl.webhookEvents(scope)],
      ['jobLogs', 'ops', 'jobLogs', (ctrl: ReportsController, scope: any) => ctrl.jobLogs(scope)],
      ['deadLetters', 'ops', 'deadLetters', (ctrl: ReportsController, scope: any) => ctrl.deadLetters(scope)],
      ['stats', 'ops', 'stats', (ctrl: ReportsController, scope: any) => ctrl.stats(scope)],
      ['missingRates', 'ops', 'missingRates', (ctrl: ReportsController, scope: any) => ctrl.missingRates(scope)],
    ] as const)('%s: scoped MEMBER throws ForbiddenException (service not called); flag-off MEMBER calls the service', async (_name, group, method, invoke) => {
      const mockFn = jest.fn().mockResolvedValue({});
      const collaborator = { [method]: mockFn } as any;

      const scopedCtrl = makeCtrl({ [group]: collaborator } as any);
      expect(() => invoke(scopedCtrl, SCOPED_MEMBER_SCOPE)).toThrow(ForbiddenException);
      expect(mockFn).not.toHaveBeenCalled();

      const flagOffCtrl = makeCtrl({ [group]: collaborator } as any);
      await invoke(flagOffCtrl, FLAG_OFF_MEMBER_SCOPE);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('budgetStatus', () => {
    // requireLeadView() lives in BudgetsService.clientBudgetStatus itself — this
    // controller handler is a thin passthrough with no gating of its own.
    it('delegates to budgets.clientBudgetStatus with the given month + scope', async () => {
      const budgets = makeBudgets();
      const ctrl = makeCtrl({ budgets });
      await ctrl.budgetStatus(OWNER_SCOPE, '2026-06');
      expect(budgets.clientBudgetStatus).toHaveBeenCalledWith({ month: '2026-06', scope: OWNER_SCOPE });
    });

    it('passes undefined month when not supplied', async () => {
      const budgets = makeBudgets();
      const ctrl = makeCtrl({ budgets });
      await ctrl.budgetStatus(OWNER_SCOPE);
      expect(budgets.clientBudgetStatus).toHaveBeenCalledWith({ month: undefined, scope: OWNER_SCOPE });
    });
  });

  describe('sprints', () => {
    it('GET /reports/sprints delegates status + paging + scope to the service', async () => {
      const sprints = { sprints: jest.fn().mockResolvedValue({ items: [], total: 0 }), sprintFolders: jest.fn(), velocity: jest.fn(), sprintDetail: jest.fn() } as any;
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints(OWNER_SCOPE, 's1', 'f1', 'completed', 'foo', '25', '0');
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 's1', folderId: 'f1', status: 'completed', search: 'foo', limit: 25, offset: 0 }), OWNER_SCOPE);
    });

    it('defaults status to "active" (not "all") when omitted — the sprints list default differs from tasks/time-entries', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints(OWNER_SCOPE);
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), OWNER_SCOPE);
    });

    it('ignores an unrecognized status value and falls back to "active"', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints(OWNER_SCOPE, undefined, undefined, 'bogus');
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), OWNER_SCOPE);
    });

    it('defaults limit/offset when the query params are missing', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints(OWNER_SCOPE);
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }), OWNER_SCOPE);
    });
  });

  describe('sprintFolders', () => {
    it('delegates spaceId + scope to sprintsReports.sprintFolders', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprintFolders(OWNER_SCOPE, '3577824');
      expect(sprints.sprintFolders).toHaveBeenCalledWith('3577824', OWNER_SCOPE);
    });
  });

  describe('velocity', () => {
    it('delegates folderId + limit + scope to sprintsReports.velocity', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.velocity(OWNER_SCOPE, 'F1', '5');
      expect(sprints.velocity).toHaveBeenCalledWith('F1', 5, OWNER_SCOPE);
    });

    it('defaults limit to 12 when omitted', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.velocity(OWNER_SCOPE, 'F1');
      expect(sprints.velocity).toHaveBeenCalledWith('F1', 12, OWNER_SCOPE);
    });

    it('rejects a missing folderId with BadRequestException', () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      expect(() => ctrl.velocity(OWNER_SCOPE)).toThrow(BadRequestException);
      expect(sprints.velocity).not.toHaveBeenCalled();
    });
  });

  describe('sprintDetail', () => {
    it('delegates listId + scope to sprintsReports.sprintDetail', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprintDetail('L1', OWNER_SCOPE);
      expect(sprints.sprintDetail).toHaveBeenCalledWith('L1', OWNER_SCOPE);
    });
  });

  describe('work', () => {
    it('passes filters through, normalizes sprintStatus and numbers', async () => {
      const work = { work: jest.fn().mockResolvedValue({ items: [] }), workEntries: jest.fn() };
      const ctrl = makeCtrl({ work });
      await ctrl.work(OWNER_SCOPE, '2026-09-01', '2026-09-14', 's1', 'checkout', 'complete', undefined, undefined, 'Sam', 'u1', undefined, 'true', 'Acme', undefined, undefined, undefined, 'include', 'bogus', 'partial', 'cost', 'asc', '25', '50');
      expect(work.work).toHaveBeenCalledWith(expect.objectContaining({
        from: '2026-09-01', to: '2026-09-14', spaceId: 's1', search: 'checkout', status: 'complete',
        assignedTo: 'Sam', loggedBy: 'u1', missingOnly: 'true', client: 'Acme', archived: 'include',
        sprintStatus: 'all', chargeable: 'partial', sort: 'cost', dir: 'asc', limit: 25, offset: 50,
      }));
    });

    it('entries route reuses the same params', async () => {
      const work = { work: jest.fn(), workEntries: jest.fn().mockResolvedValue({ items: [], truncated: false }) };
      const ctrl = makeCtrl({ work });
      await ctrl.workEntries(OWNER_SCOPE, '2026-09-01', '2026-09-14');
      expect(work.workEntries).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-09-01', sprintStatus: 'all' }));
    });
  });

  // Regression guard for the route-ordering pitfall: if `sprints/:listId` were
  // declared before the static `sprints/folders` / `sprints/velocity` paths,
  // Nest/Express would capture those requests as `listId = 'folders'` /
  // `'velocity'`. Boots the real controller through Nest's HTTP stack (with
  // every collaborator stubbed — no database) so this is verified by an actual
  // routed request, not just by reading the declaration order.
  describe('sprint route ordering (HTTP)', () => {
    async function bootApp(sprints: any) {
      const moduleRef = await Test.createTestingModule({
        controllers: [ReportsController],
        providers: [
          { provide: TasksReportService, useValue: {} },
          { provide: TimeEntriesReportService, useValue: {} },
          { provide: CostTrendReportService, useValue: {} },
          { provide: CycleTimeReportService, useValue: {} },
          { provide: AnomalyReportService, useValue: {} },
          { provide: OpsReportService, useValue: {} },
          { provide: SettingsService, useValue: makeSettings() },
          { provide: BudgetsService, useValue: makeBudgets() },
          { provide: SprintsReportService, useValue: sprints },
          { provide: WorkReportService, useValue: {} },
        ],
      }).compile();
      const app = moduleRef.createNestApplication();
      // No AccessScopeGuard is registered in this bare controller-only test
      // module (this suite is only about route-ordering), so `@Scope()`
      // would otherwise 403 on the missing request property. Stand in for
      // the guard with a trivial middleware.
      app.use((req: any, _res: any, next: () => void) => {
        req[SCOPE_PARAM] = OWNER_SCOPE;
        next();
      });
      await app.init();
      return app;
    }

    it('GET /reports/sprints/folders hits sprintFolders, not sprintDetail', async () => {
      const sprints = makeSprints();
      const app = await bootApp(sprints);
      await request(app.getHttpServer()).get('/reports/sprints/folders').expect(200);
      expect(sprints.sprintFolders).toHaveBeenCalledTimes(1);
      expect(sprints.sprintDetail).not.toHaveBeenCalled();
      await app.close();
    });

    it('GET /reports/sprints/velocity hits velocity, not sprintDetail', async () => {
      const sprints = makeSprints();
      const app = await bootApp(sprints);
      await request(app.getHttpServer()).get('/reports/sprints/velocity?folderId=F1').expect(200);
      expect(sprints.velocity).toHaveBeenCalledTimes(1);
      expect(sprints.sprintDetail).not.toHaveBeenCalled();
      await app.close();
    });

    it('GET /reports/sprints/SOME_LIST_ID falls through to sprintDetail (the param route still works)', async () => {
      const sprints = makeSprints();
      const app = await bootApp(sprints);
      await request(app.getHttpServer()).get('/reports/sprints/SOME_LIST_ID').expect(200);
      expect(sprints.sprintDetail).toHaveBeenCalledWith('SOME_LIST_ID', OWNER_SCOPE);
      await app.close();
    });
  });

  describe('tasks (sprintStatus + chargeable passthrough)', () => {
    // Positions in the service's argument list. `scope` is now index 0
    // (Ruling R10: required params can't follow optional ones, so it moved to
    // the front) — naming the index makes adding another param a
    // compile-time-obvious edit rather than three mystery failures.
    const SPRINT_STATUS_ARG = 16;
    const CHARGEABLE_ARG = 17;

    function callTasks(ctrl: ReportsController, sprintStatus?: string, chargeable?: string) {
      return ctrl.tasks(
        OWNER_SCOPE,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        sprintStatus, chargeable,
      );
    }

    function ctrlWithSpy() {
      const tasks = { tasks: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      return { tasks, ctrl: makeCtrl({ tasks }) };
    }

    it('normalizes and threads sprintStatus="completed" through to the service', async () => {
      const { tasks, ctrl } = ctrlWithSpy();
      await callTasks(ctrl, 'completed');
      expect(tasks.tasks.mock.calls[0][SPRINT_STATUS_ARG]).toBe('completed');
    });

    it('defaults an unrecognized sprintStatus to "all" (backward-compatible no-op)', async () => {
      const { tasks, ctrl } = ctrlWithSpy();
      await callTasks(ctrl, 'bogus');
      expect(tasks.tasks.mock.calls[0][SPRINT_STATUS_ARG]).toBe('all');
    });

    it('defaults a missing sprintStatus to "all"', async () => {
      const { tasks, ctrl } = ctrlWithSpy();
      await callTasks(ctrl);
      expect(tasks.tasks.mock.calls[0][SPRINT_STATUS_ARG]).toBe('all');
    });

    // `chargeable` is threaded RAW — unlike sprintStatus it has no normalizer,
    // because the service treats anything unrecognized as "no clause".
    it.each(['true', 'false', 'partial'])('threads chargeable=%s through to the service', async (value) => {
      const { tasks, ctrl } = ctrlWithSpy();
      await callTasks(ctrl, undefined, value);
      expect(tasks.tasks.mock.calls[0][CHARGEABLE_ARG]).toBe(value);
    });

    it('passes chargeable through as undefined when absent', async () => {
      const { tasks, ctrl } = ctrlWithSpy();
      await callTasks(ctrl);
      expect(tasks.tasks.mock.calls[0][CHARGEABLE_ARG]).toBeUndefined();
    });
  });

  describe('chargeablePreview', () => {
    it('parses the csv taskIds and threads chargeable through to the service', async () => {
      const tasks = { chargeablePreview: jest.fn().mockResolvedValue({ tasks: 3, changing: 3, timeEntries: 0, hours: 0 }) } as any;
      const ctrl = makeCtrl({ tasks });
      await ctrl.chargeablePreview(OWNER_SCOPE, 't1,t2,t3', 'true');
      expect(tasks.chargeablePreview).toHaveBeenCalledWith(['t1', 't2', 't3'], true, OWNER_SCOPE);
    });

    it('defaults chargeable to false when omitted', async () => {
      const tasks = { chargeablePreview: jest.fn().mockResolvedValue({ tasks: 1, changing: 1, timeEntries: 0, hours: 0 }) } as any;
      const ctrl = makeCtrl({ tasks });
      await ctrl.chargeablePreview(OWNER_SCOPE, 't1');
      expect(tasks.chargeablePreview).toHaveBeenCalledWith(['t1'], false, OWNER_SCOPE);
    });

    it('rejects a missing taskIds with BadRequestException', () => {
      const tasks = { chargeablePreview: jest.fn() } as any;
      const ctrl = makeCtrl({ tasks });
      expect(() => ctrl.chargeablePreview(OWNER_SCOPE)).toThrow(BadRequestException);
      expect(tasks.chargeablePreview).not.toHaveBeenCalled();
    });

    it('rejects more than 500 task ids with BadRequestException', () => {
      const tasks = { chargeablePreview: jest.fn() } as any;
      const ctrl = makeCtrl({ tasks });
      const taskIds = Array.from({ length: 501 }, (_, i) => `t${i}`).join(',');
      expect(() => ctrl.chargeablePreview(OWNER_SCOPE, taskIds)).toThrow(BadRequestException);
      expect(tasks.chargeablePreview).not.toHaveBeenCalled();
    });
  });

  describe('timeEntriesList (sprintStatus passthrough)', () => {
    // Pinned by position rather than "the last argument": `taskId` now trails
    // sprintStatus in the service signature, and any future trailing param
    // would silently make these assertions inspect the wrong slot. `scope` is
    // index 0 (Ruling R10: required params can't follow optional ones).
    const SPRINT_STATUS_ARG = 15;

    it('normalizes and threads sprintStatus="active" through to the service', async () => {
      const timeEntries = { timeEntriesList: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesList(
        OWNER_SCOPE,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'active',
      );
      expect(timeEntries.timeEntriesList.mock.calls[0][SPRINT_STATUS_ARG]).toBe('active');
    });

    it('defaults an unrecognized sprintStatus to "all"', async () => {
      const timeEntries = { timeEntriesList: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesList(
        OWNER_SCOPE,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'nonsense',
      );
      expect(timeEntries.timeEntriesList.mock.calls[0][SPRINT_STATUS_ARG]).toBe('all');
    });

    it('threads taskId through so a grouped row can expand into its own entries', async () => {
      const timeEntries = { timeEntriesList: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesList(
        OWNER_SCOPE,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, '86abc123',
      );
      expect(timeEntries.timeEntriesList.mock.calls[0][SPRINT_STATUS_ARG + 1]).toBe('86abc123');
    });
  });

  describe('timeEntriesByTask', () => {
    function makeGrouped() {
      return { timeEntriesByTask: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
    }

    it('passes the page\'s filters straight through to the grouped query', async () => {
      const timeEntries = makeGrouped();
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesByTask(
        OWNER_SCOPE,
        'u1,u2', '2026-01-01', '2026-02-01', 'NO_RATE_FOUND', '25', '50',
        'true', 'webhook', 'space-1', undefined, 'Acme', 'list-1', 'folder-1', 'exclude', 'active',
      );
      expect(timeEntries.timeEntriesByTask).toHaveBeenCalledWith({
        userId: 'u1,u2', from: '2026-01-01', to: '2026-02-01', status: 'NO_RATE_FOUND',
        limit: 25, offset: 50, chargeable: 'true', search: 'webhook', spaceId: 'space-1',
        missingOnly: undefined, client: 'Acme', listId: 'list-1', folderId: 'folder-1',
        archived: 'exclude', sprintStatus: 'active', scope: OWNER_SCOPE,
      });
    });

    it('defaults an unrecognized sprintStatus to "all", like the flat list', async () => {
      const timeEntries = makeGrouped();
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesByTask(
        OWNER_SCOPE,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'nonsense',
      );
      expect(timeEntries.timeEntriesByTask.mock.calls[0][0].sprintStatus).toBe('all');
    });

    it('falls back to a 50-task page when limit/offset are absent', async () => {
      const timeEntries = makeGrouped();
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesByTask(OWNER_SCOPE);
      expect(timeEntries.timeEntriesByTask.mock.calls[0][0]).toMatchObject({ limit: 50, offset: 0 });
    });
  });
});
