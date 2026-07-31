import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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

describe('ReportsController', () => {
  // Build a controller wiring the report sub-services + settings + budgets.
  // Each `over` key replaces one collaborator; the rest are inert stubs. Keeps
  // call sites short and resilient to the constructor arg order.
  function makeCtrl(over: Partial<{
    tasks: any; timeEntries: any; costTrend: any; cycleTime: any; anomaly: any; ops: any; settings: any; budgets: any; sprints: any;
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
    } as any;
  }

  function makeBudgets() {
    return { clientBudgetStatus: jest.fn().mockResolvedValue([]) } as any;
  }

  describe('overviewDeltas', () => {
    function makeTimeEntriesWithDeltas() {
      return {
        overviewDeltas: jest.fn().mockResolvedValue({
          current: { totalHours: 10, totalCostAud: 1000 },
          prior:   { totalHours: 8,  totalCostAud: 800 },
        }),
      } as any;
    }

    it('passes from/to through to the service', async () => {
      const timeEntries = makeTimeEntriesWithDeltas();
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.overviewDeltas('2026-05-01', '2026-05-31');
      expect(timeEntries.overviewDeltas).toHaveBeenCalledWith('2026-05-01', '2026-05-31');
    });

    it('returns the service result unchanged', async () => {
      const timeEntries = makeTimeEntriesWithDeltas();
      const ctrl = makeCtrl({ timeEntries });
      const result = await ctrl.overviewDeltas();
      expect(result).toEqual({
        current: { totalHours: 10, totalCostAud: 1000 },
        prior:   { totalHours: 8,  totalCostAud: 800 },
      });
    });
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
      const result = await ctrl.anomalies();
      expect(anomaly.anomalies).toHaveBeenCalledTimes(1);
      expect(result.dailySpikes).toHaveLength(1);
      expect(result.clientSpikes).toEqual([]);
    });
  });

  describe('costTrend', () => {
    it('passes bucket + from + to through to the service for valid bucket', async () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      await ctrl.costTrend('day', '2026-05-01', '2026-05-21');
      expect(costTrend.costTrend).toHaveBeenCalledWith('day', '2026-05-01', '2026-05-21');
    });

    it('rejects bucket="hour" with BadRequestException', () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      expect(() => ctrl.costTrend('hour' as any)).toThrow(BadRequestException);
      expect(costTrend.costTrend).not.toHaveBeenCalled();
    });

    it('rejects missing bucket', () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      expect(() => ctrl.costTrend(undefined as any)).toThrow(BadRequestException);
      expect(costTrend.costTrend).not.toHaveBeenCalled();
    });

    it.each(['day', 'week', 'month'] as const)('accepts bucket=%s', async (b) => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      await ctrl.costTrend(b);
      expect(costTrend.costTrend).toHaveBeenCalledWith(b, undefined, undefined);
    });
  });

  describe('hourSpikes', () => {
    it('passes the settings cap + from/to into the service with default limit/includeResolved', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = makeCtrl({ anomaly, settings });
      const result = await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(settings.getSpikeHoursCap).toHaveBeenCalledTimes(1);
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, true);
      expect(result.cap).toBe(10);
    });

    it('passes the cap, range, limit and includeResolved through', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = makeCtrl({ anomaly, settings });
      await ctrl.hourSpikes('2026-06-01', '2026-06-10', '40', 'true');
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 40, true, true);
    });

    it('forwards medianEnabled=false from settings into the service', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const ctrl = makeCtrl({ anomaly, settings: makeSettings(10, false) });
      await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, false);
    });
  });

  describe('budgetStatus', () => {
    it('delegates to budgets.clientBudgetStatus with the given month', async () => {
      const budgets = makeBudgets();
      const ctrl = makeCtrl({ budgets });
      await ctrl.budgetStatus('2026-06');
      expect(budgets.clientBudgetStatus).toHaveBeenCalledWith({ month: '2026-06' });
    });

    it('passes undefined month when not supplied', async () => {
      const budgets = makeBudgets();
      const ctrl = makeCtrl({ budgets });
      await ctrl.budgetStatus();
      expect(budgets.clientBudgetStatus).toHaveBeenCalledWith({ month: undefined });
    });
  });

  describe('sprints', () => {
    it('GET /reports/sprints delegates status + paging to the service', async () => {
      const sprints = { sprints: jest.fn().mockResolvedValue({ items: [], total: 0 }), sprintFolders: jest.fn(), velocity: jest.fn(), sprintDetail: jest.fn() } as any;
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints('s1', 'f1', 'completed', 'foo', '25', '0');
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 's1', folderId: 'f1', status: 'completed', search: 'foo', limit: 25, offset: 0 }));
    });

    it('defaults status to "active" (not "all") when omitted — the sprints list default differs from tasks/time-entries', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints();
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('ignores an unrecognized status value and falls back to "active"', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints(undefined, undefined, 'bogus');
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('defaults limit/offset when the query params are missing', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprints();
      expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    });
  });

  describe('sprintFolders', () => {
    it('delegates spaceId to sprintsReports.sprintFolders', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprintFolders('3577824');
      expect(sprints.sprintFolders).toHaveBeenCalledWith('3577824');
    });
  });

  describe('velocity', () => {
    it('delegates folderId + limit to sprintsReports.velocity', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.velocity('F1', '5');
      expect(sprints.velocity).toHaveBeenCalledWith('F1', 5);
    });

    it('defaults limit to 12 when omitted', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.velocity('F1');
      expect(sprints.velocity).toHaveBeenCalledWith('F1', 12);
    });

    it('rejects a missing folderId with BadRequestException', () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      expect(() => ctrl.velocity()).toThrow(BadRequestException);
      expect(sprints.velocity).not.toHaveBeenCalled();
    });
  });

  describe('sprintDetail', () => {
    it('delegates listId to sprintsReports.sprintDetail', async () => {
      const sprints = makeSprints();
      const ctrl = makeCtrl({ sprints });
      await ctrl.sprintDetail('L1');
      expect(sprints.sprintDetail).toHaveBeenCalledWith('L1');
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
        ],
      }).compile();
      const app = moduleRef.createNestApplication();
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
      expect(sprints.sprintDetail).toHaveBeenCalledWith('SOME_LIST_ID');
      await app.close();
    });
  });

  describe('tasks (sprintStatus passthrough)', () => {
    function callTasks(ctrl: ReportsController, sprintStatus?: string) {
      return ctrl.tasks(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        sprintStatus,
      );
    }

    it('normalizes and threads sprintStatus="completed" through to the service', async () => {
      const tasks = { tasks: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ tasks });
      await callTasks(ctrl, 'completed');
      const args = tasks.tasks.mock.calls[0];
      expect(args[args.length - 1]).toBe('completed');
    });

    it('defaults an unrecognized sprintStatus to "all" (backward-compatible no-op)', async () => {
      const tasks = { tasks: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ tasks });
      await callTasks(ctrl, 'bogus');
      const args = tasks.tasks.mock.calls[0];
      expect(args[args.length - 1]).toBe('all');
    });

    it('defaults a missing sprintStatus to "all"', async () => {
      const tasks = { tasks: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ tasks });
      await callTasks(ctrl);
      const args = tasks.tasks.mock.calls[0];
      expect(args[args.length - 1]).toBe('all');
    });
  });

  describe('timeEntriesList (sprintStatus passthrough)', () => {
    it('normalizes and threads sprintStatus="active" through to the service', async () => {
      const timeEntries = { timeEntriesList: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesList(
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'active',
      );
      const args = timeEntries.timeEntriesList.mock.calls[0];
      expect(args[args.length - 1]).toBe('active');
    });

    it('defaults an unrecognized sprintStatus to "all"', async () => {
      const timeEntries = { timeEntriesList: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.timeEntriesList(
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'nonsense',
      );
      const args = timeEntries.timeEntriesList.mock.calls[0];
      expect(args[args.length - 1]).toBe('all');
    });
  });
});
