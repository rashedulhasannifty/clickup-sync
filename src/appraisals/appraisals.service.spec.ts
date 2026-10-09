import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AppraisalsService } from './appraisals.service';

const admin = {
  userId: 'u-admin',
  orgId: 'org',
  role: 'ADMIN',
  email: 'a@x',
  isMachine: false,
} as never;

const COMPETENCIES = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
];

const cycle = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  orgId: 'org',
  name: 'H2 2026',
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-12-31T00:00:00Z'),
  status: 'OPEN',
  kpiWeight: 70,
  competencies: COMPETENCIES,
  createdBy: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
});

const snapshot = {
  period: { from: '2026-07-01', to: '2026-12-31' },
  computedAt: '2026-10-01T00:00:00.000Z',
  kpis: {},
  overall: { score: 82, band: 'on-track', partial: false, basedOn: [] },
};

type Row = Record<string, any>;

const appraisal = (over: Record<string, unknown> = {}): Row => ({
  id: 'a1',
  cycleId: 'c1',
  employeeId: 'e1',
  reviewerId: 'm1',
  status: 'SELF_REVIEW',
  selfRatings: {},
  selfComment: null,
  leadRatings: {},
  leadComment: null,
  strengths: null,
  improvements: null,
  goals: null,
  recommendation: null,
  newDesignation: null,
  calibrationNote: null,
  calibratedScore: null,
  kpiSnapshot: null,
  kpiSnapshotAt: null,
  finalScore: null,
  finalPartial: null,
  signedOffAt: null,
  signedOffBy: null,
  outcomeAppliedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  cycle: cycle(),
  employee: {
    id: 'e1',
    fullName: 'Ada',
    designation: 'Developer',
    employeeCode: null,
    clickupUserId: 'cu1',
    status: 'ACTIVE',
    team: { name: 'Core' },
  },
  reviewer: { id: 'm1', fullName: 'Grace' },
  ...over,
});

const completeLead = {
  leadRatings: { a: 4, b: 5 },
  recommendation: 'RAISE',
  kpiSnapshot: snapshot,
};

function make(
  rows: { current: Row | null },
  over: Record<string, jest.Mock> = {},
) {
  const repo = {
    listCycles: jest.fn().mockResolvedValue([cycle()]),
    findCycle: jest.fn().mockImplementation(async (org: string) =>
      org === 'org' ? cycle() : null,
    ),
    createCycle: jest.fn().mockImplementation(async (d) =>
      cycle({
        ...d,
        periodStart: new Date(`${d.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${d.periodEnd}T00:00:00Z`),
      }),
    ),
    updateCycle: jest.fn().mockResolvedValue(cycle()),
    statusCounts: jest.fn().mockResolvedValue([]),
    launchCandidates: jest
      .fn()
      .mockResolvedValue([{ id: 'e1', managerId: 'm1' }]),
    createAppraisals: jest.fn().mockResolvedValue(1),
    listByCycle: jest.fn().mockResolvedValue([]),
    findAppraisal: jest.fn().mockImplementation(async (org: string) =>
      org === 'org' ? rows.current : null,
    ),
    listForEmployee: jest.fn().mockResolvedValue([]),
    updateIf: jest.fn().mockImplementation(async (_id, expected, data) => {
      if (!rows.current || rows.current.status !== expected) return false;
      rows.current = { ...rows.current, ...data };
      return true;
    }),
    markOutcomeApplied: jest.fn().mockImplementation(async () => {
      if (!rows.current || rows.current.outcomeAppliedAt) return false;
      rows.current = { ...rows.current, outcomeAppliedAt: new Date() };
      return true;
    }),
    ...over,
  };
  const summaries = {
    kpisForPeriod: jest.fn().mockResolvedValue({
      kpis: {},
      overall: { score: 82, band: 'on-track', partial: false, basedOn: [] },
      hours: { clickup: 0, chargeable: 0, available: 0 },
    }),
  };
  const employees = {
    getProfile: jest.fn().mockResolvedValue({ id: 'e1' }),
    addEvent: jest.fn().mockResolvedValue({}),
  };
  const svc = new AppraisalsService(
    repo as never,
    summaries as never,
    employees as never,
  );
  return { svc, repo, summaries, employees, rows };
}

describe('AppraisalsService cycles', () => {
  it('creates a cycle with the default weight and competencies', async () => {
    const { svc, repo } = make({ current: null });
    const v = await svc.createCycle(admin, {
      name: ' H2 2026 ',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
    });
    const arg = repo.createCycle.mock.calls[0][0];
    expect(arg.kpiWeight).toBe(70);
    expect(arg.competencies.map((c: { key: string }) => c.key)).toEqual([
      'technical_skill',
      'communication',
      'ownership',
      'mentoring',
    ]);
    expect(arg.name).toBe('H2 2026');
    expect(arg.orgId).toBe('org');
    expect(v.counts.total).toBe(0);
  });

  it('refuses an inverted period and bad competencies', async () => {
    const { svc } = make({ current: null });
    await expect(
      svc.createCycle(admin, {
        name: 'x',
        periodStart: '2026-12-31',
        periodEnd: '2026-07-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.createCycle(admin, {
        name: 'x',
        periodStart: '2026-07-01',
        periodEnd: '2026-12-31',
        competencies: [
          { key: 'a', label: 'A' },
          { key: 'a', label: 'B' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is a 404 for another org’s cycle', async () => {
    const { svc } = make({ current: null });
    await expect(svc.getCycle('other', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('locks period, weight and competencies once appraisals exist', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        statusCounts: jest
          .fn()
          .mockResolvedValue([
            { cycleId: 'c1', status: 'SELF_REVIEW', count: 3 },
          ]),
      },
    );
    await expect(
      svc.updateCycle('org', 'c1', { kpiWeight: 50 }),
    ).rejects.toBeInstanceOf(ConflictException);
    // Renaming and closing are still fine, and an unchanged weight is not a change.
    await svc.updateCycle('org', 'c1', {
      name: 'New name',
      kpiWeight: 70,
      status: 'CLOSED',
    });
    expect(repo.updateCycle).toHaveBeenCalledWith('c1', {
      name: 'New name',
      status: 'CLOSED',
    });
  });

  it('refuses an impossible status move', async () => {
    const { svc } = make({ current: null });
    await expect(
      svc.updateCycle('org', 'c1', { status: 'DRAFT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('launches the default selection and reports created and skipped', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        launchCandidates: jest.fn().mockResolvedValue([
          { id: 'e1', managerId: 'm1' },
          { id: 'e2', managerId: null },
        ]),
        createAppraisals: jest.fn().mockResolvedValue(1),
      },
    );
    const r = await svc.launch('org', 'c1', {});
    expect(repo.launchCandidates).toHaveBeenCalledWith(
      'org',
      '2026-12-31',
      undefined,
    );
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('rejects a selection with an unknown employee, an empty one, and a closed cycle', async () => {
    const { svc } = make({ current: null });
    await expect(
      svc.launch('org', 'c1', { employeeIds: ['e1', 'nope'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.launch('org', 'c1', { employeeIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const closed = make(
      { current: null },
      { findCycle: jest.fn().mockResolvedValue(cycle({ status: 'CLOSED' })) },
    );
    await expect(closed.svc.launch('org', 'c1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('AppraisalsService.update', () => {
  it('saves the current step’s fields', async () => {
    const rows = { current: appraisal() };
    const { svc, repo } = make(rows);
    await svc.update('org', 'a1', {
      selfRatings: { a: 4 },
      selfComment: '  went well ',
    });
    expect(repo.updateIf).toHaveBeenCalledWith('a1', 'SELF_REVIEW', {
      selfRatings: { a: 4 },
      selfComment: 'went well',
    });
  });

  it('refuses a field that belongs to another step', async () => {
    const { svc } = make({ current: appraisal() });
    await expect(
      svc.update('org', 'a1', { leadRatings: { a: 4 } }),
    ).rejects.toThrow(/cannot be edited during SELF_REVIEW/);
  });

  it('refuses unknown competencies and out-of-range ratings', async () => {
    const { svc } = make({ current: appraisal() });
    await expect(
      svc.update('org', 'a1', { selfRatings: { zzz: 3 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update('org', 'a1', { selfRatings: { a: 6 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears a stale designation when the recommendation stops being PROMOTE', async () => {
    const rows = {
      current: appraisal({
        status: 'LEAD_REVIEW',
        recommendation: 'PROMOTE',
        newDesignation: 'Senior',
      }),
    };
    const { svc, repo } = make(rows);
    await svc.update('org', 'a1', { recommendation: 'RAISE' });
    expect(repo.updateIf).toHaveBeenCalledWith('a1', 'LEAD_REVIEW', {
      recommendation: 'RAISE',
      newDesignation: null,
    });
  });

  it('is read-only once signed off', async () => {
    const { svc } = make({
      current: appraisal({ status: 'SIGNED_OFF', ...completeLead }),
    });
    await expect(
      svc.update('org', 'a1', { calibrationNote: 'x' }),
    ).rejects.toThrow(/signed off/);
  });

  it('is read-only while the cycle is not open', async () => {
    const { svc } = make({
      current: appraisal({ cycle: cycle({ status: 'CLOSED' }) }),
    });
    await expect(
      svc.update('org', 'a1', { selfComment: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('is read-only once the employee has exited: save, advance, send back and refresh all refuse', async () => {
    const exited = appraisal({
      status: 'LEAD_REVIEW',
      ...completeLead,
      employee: { ...appraisal().employee, status: 'EXITED' },
    });
    const { svc } = make({ current: exited });
    const principal = { orgId: 'org', userId: 'u1', isMachine: false } as never;
    await expect(svc.update('org', 'a1', { goals: 'x' })).rejects.toThrow(/exited/);
    await expect(svc.advance(principal, 'a1')).rejects.toThrow(/exited/);
    await expect(svc.sendBack('org', 'a1')).rejects.toThrow(/exited/);
    await expect(svc.refreshKpis('org', 'a1')).rejects.toThrow(/exited/);
  });

  it('is a 404 for another org’s appraisal', async () => {
    const { svc } = make({ current: appraisal() });
    await expect(
      svc.update('other', 'a1', { selfComment: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a conflict when the step moved underneath the save', async () => {
    const { svc } = make(
      { current: appraisal() },
      { updateIf: jest.fn().mockResolvedValue(false) },
    );
    await expect(
      svc.update('org', 'a1', { selfComment: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AppraisalsService.advance', () => {
  it('snapshots the cycle period’s KPIs when entering lead review', async () => {
    const rows = { current: appraisal() };
    const { svc, summaries } = make(rows);
    const v = await svc.advance(admin, 'a1');
    expect(summaries.kpisForPeriod).toHaveBeenCalledTimes(1);
    const [org, emp, period] = summaries.kpisForPeriod.mock.calls[0];
    expect([org, emp, period.from]).toEqual(['org', 'e1', '2026-07-01']);
    // Clipped to today, never beyond the cycle end.
    expect(period.to <= '2026-12-31').toBe(true);
    expect(v.status).toBe('LEAD_REVIEW');
    expect(v.kpiSnapshot?.overall.score).toBe(82);
  });

  it('will not leave lead review until it is complete', async () => {
    const { svc } = make({
      current: appraisal({ status: 'LEAD_REVIEW', kpiSnapshot: snapshot }),
    });
    await expect(svc.advance(admin, 'a1')).rejects.toThrow(/Rate every competency/);
  });

  it('moves lead review to calibration without touching employment events', async () => {
    const rows = {
      current: appraisal({ status: 'LEAD_REVIEW', ...completeLead }),
    };
    const { svc, employees } = make(rows);
    const v = await svc.advance(admin, 'a1');
    expect(v.status).toBe('CALIBRATION');
    expect(employees.addEvent).not.toHaveBeenCalled();
  });

  it('signs off: freezes the score and applies a promotion once', async () => {
    const rows = {
      current: appraisal({
        status: 'CALIBRATION',
        ...completeLead,
        recommendation: 'PROMOTE',
        newDesignation: 'Senior Developer',
      }),
    };
    const { svc, employees } = make(rows);

    const first = await svc.advance(admin, 'a1');
    expect(first.status).toBe('SIGNED_OFF');
    expect(first.outcomeApplied).toBe(true);
    expect(first.score.final).toBe(4.2);
    expect(employees.addEvent).toHaveBeenCalledTimes(1);
    expect(employees.addEvent).toHaveBeenCalledWith(
      admin,
      'e1',
      expect.objectContaining({
        type: 'PROMOTED',
        toValue: 'Senior Developer',
      }),
    );

    // Signing off again changes nothing.
    const second = await svc.advance(admin, 'a1');
    expect(second.status).toBe('SIGNED_OFF');
    expect(employees.addEvent).toHaveBeenCalledTimes(1);
  });

  it('writes a NOTE for a raise and nothing for NO_CHANGE', async () => {
    const raise = make({
      current: appraisal({ status: 'CALIBRATION', ...completeLead }),
    });
    await raise.svc.advance(admin, 'a1');
    expect(raise.employees.addEvent).toHaveBeenCalledWith(
      admin,
      'e1',
      expect.objectContaining({
        type: 'NOTE',
        notes: 'Salary increase recommended — appraisal H2 2026',
      }),
    );

    const none = make({
      current: appraisal({
        status: 'CALIBRATION',
        ...completeLead,
        recommendation: 'NO_CHANGE',
      }),
    });
    const v = await none.svc.advance(admin, 'a1');
    expect(none.employees.addEvent).not.toHaveBeenCalled();
    expect(v.outcomeApplied).toBe(true);
  });

  it('finishes an outcome that failed to land instead of skipping it', async () => {
    const rows = {
      current: appraisal({ status: 'CALIBRATION', ...completeLead }),
    };
    const { svc, employees } = make(rows);
    employees.addEvent.mockRejectedValueOnce(new Error('db down'));

    await expect(svc.advance(admin, 'a1')).rejects.toThrow('db down');
    expect(rows.current?.status).toBe('SIGNED_OFF');
    expect(rows.current?.outcomeAppliedAt).toBeNull();

    const v = await svc.advance(admin, 'a1');
    expect(v.outcomeApplied).toBe(true);
    expect(employees.addEvent).toHaveBeenCalledTimes(2);
  });

  it('uses the calibrated score when one is set', async () => {
    const rows = {
      current: appraisal({
        status: 'CALIBRATION',
        ...completeLead,
        calibratedScore: 3.5,
      }),
    };
    const v = await make(rows).svc.advance(admin, 'a1');
    expect(v.score.final).toBe(3.5);
    expect(v.score.calibrated).toBe(true);
  });

  it('is Partial when the employee is not linked to ClickUp', async () => {
    const rows = {
      current: appraisal({
        status: 'CALIBRATION',
        ...completeLead,
        kpiSnapshot: {
          ...snapshot,
          overall: { ...snapshot.overall, partial: true },
        },
      }),
    };
    const v = await make(rows).svc.advance(admin, 'a1');
    expect(v.score.partial).toBe(true);
  });

  it('loses the race cleanly when someone else already moved it', async () => {
    const { svc } = make(
      { current: appraisal() },
      { updateIf: jest.fn().mockResolvedValue(false) },
    );
    await expect(svc.advance(admin, 'a1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('AppraisalsService.sendBack / refreshKpis', () => {
  it('sends back one step', async () => {
    const rows = { current: appraisal({ status: 'CALIBRATION' }) };
    const v = await make(rows).svc.sendBack('org', 'a1');
    expect(v.status).toBe('LEAD_REVIEW');
  });

  it('cannot send back the first step or a signed-off appraisal', async () => {
    await expect(
      make({ current: appraisal() }).svc.sendBack('org', 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make({ current: appraisal({ status: 'SIGNED_OFF' }) }).svc.sendBack(
        'org',
        'a1',
      ),
    ).rejects.toThrow(/signed-off/);
  });

  it('refreshes the snapshot before sign-off and refuses after', async () => {
    const { svc, summaries } = make({
      current: appraisal({ status: 'LEAD_REVIEW', kpiSnapshot: snapshot }),
    });
    await svc.refreshKpis('org', 'a1');
    expect(summaries.kpisForPeriod).toHaveBeenCalledTimes(1);

    await expect(
      make({
        current: appraisal({ status: 'SIGNED_OFF', kpiSnapshot: snapshot }),
      }).svc.refreshKpis('org', 'a1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AppraisalsService.employeeAppraisals', () => {
  it('404s a foreign employee before reading history', async () => {
    const { svc, employees, repo } = make({ current: null });
    employees.getProfile.mockRejectedValueOnce(new NotFoundException());
    await expect(svc.employeeAppraisals('org', 'zzz')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.listForEmployee).not.toHaveBeenCalled();
  });
});
