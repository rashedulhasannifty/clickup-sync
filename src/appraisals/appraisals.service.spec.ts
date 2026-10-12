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
  type: 'YEARLY',
  periodBasis: 'CALENDAR',
  scoringMode: 'KPI_BLEND',
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
  actions: [],
  incrementPercent: null,
  trainingPlan: null,
  deptHeadComment: null,
  hrComment: null,
  approvalDecision: null,
  approvalComment: null,
  formHeader: null,
  formDocumentId: null,
  leadReviewBy: null,
  leadReviewAt: null,
  deptHeadBy: null,
  deptHeadAt: null,
  hrBy: null,
  hrAt: null,
  approvalBy: null,
  approvalAt: null,
  kpiSnapshot: null,
  kpiSnapshotAt: null,
  finalScore: null,
  finalPartial: null,
  finalGrade: null,
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
    grossSalary: 80000,
    team: { name: 'Core' },
  },
  reviewer: { id: 'm1', fullName: 'Grace' },
  ...over,
});

function headerSource(id: string) {
  return {
    id,
    fullName: 'Ada',
    concernName: 'Nifty IT Solution Ltd',
    designation: 'Developer',
    department: 'Engineering',
    joinDate: new Date('2023-03-15T00:00:00Z'),
    exitDate: null,
    academicQualification: 'BSc',
    experienceBeforeJoiningMonths: 24,
    startingSalary: 50000,
    grossSalary: 80000,
    events: [],
  };
}

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
    findCycle: jest
      .fn()
      .mockImplementation(async (org: string) =>
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
    findAppraisal: jest
      .fn()
      .mockImplementation(async (org: string) =>
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
    headerSources: jest
      .fn()
      .mockImplementation(async (_org, ids: string[]) =>
        ids.map((id) => headerSource(id)),
      ),
    organisationName: jest.fn().mockResolvedValue('Nifty IT Solution'),
    userNames: jest.fn().mockResolvedValue(new Map([['u-admin', 'Admin']])),
    setFormDocument: jest.fn().mockImplementation(async (_id, docId) => {
      if (rows.current)
        rows.current = { ...rows.current, formDocumentId: docId };
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
    recordAppraisalOutcome: jest.fn().mockResolvedValue(undefined),
  };
  const documents = {
    enabled: true,
    storeGenerated: jest.fn().mockResolvedValue({ id: 'doc-1' }),
  };
  const svc = new AppraisalsService(
    repo as never,
    summaries as never,
    employees as never,
    documents as never,
  );
  return { svc, repo, summaries, employees, documents, rows };
}

describe('AppraisalsService cycles', () => {
  it('creates a FORM_100 cycle with the paper form’s 10 criteria by default', async () => {
    const { svc, repo } = make({ current: null });
    await svc.createCycle(admin, {
      name: 'H2 2026',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      type: 'HALF_YEARLY',
    });
    const arg = repo.createCycle.mock.calls[0][0];
    expect(arg.scoringMode).toBe('FORM_100');
    expect(arg.type).toBe('HALF_YEARLY');
    expect(arg.kpiWeight).toBe(0);
    expect(arg.competencies).toHaveLength(10);
    expect(arg.competencies[0]).toMatchObject({
      key: 'job_knowledge',
      label: 'Job Knowledge',
      description: expect.stringContaining('mastery of the concepts'),
    });
  });

  it('creates a legacy KPI_BLEND cycle with the default weight and competencies', async () => {
    const { svc, repo } = make({ current: null });
    const v = await svc.createCycle(admin, {
      name: ' H2 2026 ',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      scoringMode: 'KPI_BLEND',
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
    await expect(svc.update('org', 'a1', { goals: 'x' })).rejects.toThrow(
      /exited/,
    );
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
    await expect(svc.advance(admin, 'a1')).rejects.toThrow(
      /Rate every competency/,
    );
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

describe('AppraisalsService FORM_100 (paper form)', () => {
  const CRITERIA = [
    {
      key: 'job_knowledge',
      label: 'Job Knowledge',
      description: 'Knows the job.',
    },
    { key: 'integrity', label: 'Integrity', description: 'Honest.' },
  ];
  const formCycle = (over: Record<string, unknown> = {}) =>
    cycle({
      scoringMode: 'FORM_100',
      kpiWeight: 0,
      competencies: CRITERIA,
      ...over,
    });
  const form = (over: Record<string, unknown> = {}) =>
    appraisal({ cycle: formCycle(), ...over });
  const rated = { leadRatings: { job_knowledge: 8, integrity: 10 } };

  it('captures the form header at launch', async () => {
    const { svc, repo } = make({ current: null });
    repo.findCycle.mockResolvedValue(formCycle({ status: 'DRAFT' }));
    await svc.launch('org', 'c1', {});
    const rows = repo.createAppraisals.mock.calls[0][1];
    expect(rows[0].formHeader).toMatchObject({
      name: 'Ada',
      companyName: 'Nifty IT Solution',
      grossSalary: 80000,
      totalExperienceMonths: expect.any(Number),
    });
  });

  it('does not capture a header for a legacy cycle', async () => {
    const { svc, repo } = make({ current: null });
    await svc.launch('org', 'c1', {});
    expect(repo.headerSources).not.toHaveBeenCalled();
    expect(
      repo.createAppraisals.mock.calls[0][1][0].formHeader,
    ).toBeUndefined();
  });

  it('accepts only form ratings (2/4/6/8/10)', async () => {
    const rows = { current: form({ status: 'LEAD_REVIEW' }) };
    const { svc } = make(rows);
    await expect(
      svc.update('org', 'a1', { leadRatings: { job_knowledge: 5 } }),
    ).rejects.toThrow(/2, 4, 6, 8 or 10/);
    const v = await svc.update('org', 'a1', {
      leadRatings: { job_knowledge: 8 },
    });
    expect(v.leadRatings).toEqual({ job_knowledge: 8 });
    expect(v.score).toMatchObject({
      mode: 'FORM_100',
      outOf: 100,
      final: 40,
      grade: null,
      ratedCount: 1,
    });
  });

  it('opens each comment block only in its own step', async () => {
    const { svc } = make({ current: form({ status: 'LEAD_REVIEW' }) });
    await expect(svc.update('org', 'a1', { hrComment: 'x' })).rejects.toThrow(
      /cannot be edited during LEAD_REVIEW/,
    );
    await expect(
      svc.update('org', 'a1', { recommendation: 'RAISE' }),
    ).rejects.toThrow(/cannot be edited/);
    const dept = make({ current: form({ status: 'DEPT_HEAD_REVIEW' }) });
    await expect(
      dept.svc.update('org', 'a1', { leadRatings: { integrity: 8 } }),
    ).rejects.toThrow(/cannot be edited during DEPT_HEAD_REVIEW/);
    const v = await dept.svc.update('org', 'a1', {
      deptHeadComment: ' Agreed ',
      actions: ['CONFIRM', 'INCREMENT'],
      incrementPercent: 13,
    });
    expect(v.deptHeadComment).toBe('Agreed');
    expect(v.actions).toEqual(['CONFIRM', 'INCREMENT']);
    expect(v.incrementPercent).toBe(13);
  });

  it('drops a stale designation and percent when their action is unticked', async () => {
    const rows = {
      current: form({
        status: 'LEAD_REVIEW',
        actions: ['PROMOTION', 'INCREMENT'],
        newDesignation: 'Manager',
        incrementPercent: 15,
      }),
    };
    const v = await make(rows).svc.update('org', 'a1', {
      actions: ['CONFIRM'],
    });
    expect(v.newDesignation).toBeNull();
    expect(v.incrementPercent).toBeNull();
  });

  it('lets the self review through with nothing filled in', async () => {
    const v = await make({ current: form() }).svc.advance(admin, 'a1');
    expect(v.status).toBe('LEAD_REVIEW');
    expect(v.formHeader?.name).toBe('Ada');
  });

  it('walks supervisor -> department head -> HR -> final approval, recording who and when', async () => {
    const rows = {
      current: form({
        status: 'LEAD_REVIEW',
        ...rated,
        actions: ['CONFIRM'],
        kpiSnapshot: snapshot,
      }),
    };
    const { svc } = make(rows);
    expect((await svc.advance(admin, 'a1')).status).toBe('DEPT_HEAD_REVIEW');
    expect(rows.current?.leadReviewBy).toBe('u-admin');
    expect(rows.current?.leadReviewAt).toBeInstanceOf(Date);
    expect((await svc.advance(admin, 'a1')).status).toBe('HR_REVIEW');
    expect(rows.current?.deptHeadBy).toBe('u-admin');
    const v = await svc.advance(admin, 'a1');
    expect(v.status).toBe('FINAL_APPROVAL');
    expect(rows.current?.hrBy).toBe('u-admin');
    expect(v.steps.find((s) => s.status === 'LEAD_REVIEW')).toMatchObject({
      byName: 'Admin',
    });
    expect(v.score.kpiReference).toBe(82);
    await expect(svc.advance(admin, 'a1')).rejects.toThrow(/approval decision/);
    expect((await svc.sendBack('org', 'a1')).status).toBe('HR_REVIEW');
  });

  it('will not leave the supervisor step with criteria unrated or no recommendation', async () => {
    const { svc } = make({ current: form({ status: 'LEAD_REVIEW' }) });
    await expect(svc.advance(admin, 'a1')).rejects.toThrow(
      /Rate every criterion.*Tick at least one/,
    );
  });

  it('approved: freezes total, grade and header, writes the outcome once and files the PDF', async () => {
    const rows = {
      current: form({
        status: 'FINAL_APPROVAL',
        ...rated,
        actions: ['PROMOTION', 'INCREMENT', 'CONFIRM'],
        newDesignation: 'Senior Developer',
        incrementPercent: 13,
        approvalDecision: 'APPROVED',
      }),
    };
    const { svc, employees, documents } = make(rows);
    const v = await svc.advance(admin, 'a1');
    expect(v.status).toBe('SIGNED_OFF');
    expect(rows.current).toMatchObject({
      finalScore: 90,
      finalGrade: 'B',
      approvalBy: 'u-admin',
    });
    expect(rows.current?.formHeader).toMatchObject({ grossSalary: 80000 });
    expect(v.score).toMatchObject({
      final: 90,
      grade: 'B',
      policy: expect.objectContaining({ incrementMin: 13 }),
    });
    expect(employees.recordAppraisalOutcome).toHaveBeenCalledTimes(1);
    // ACTIVE, not on probation: CONFIRM is skipped; promotion then increment.
    expect(employees.recordAppraisalOutcome.mock.calls[0][2]).toEqual([
      expect.objectContaining({
        type: 'PROMOTED',
        toValue: 'Senior Developer',
      }),
      expect.objectContaining({
        type: 'INCREMENT',
        fromValue: '80000',
        toValue: '90400',
        notes: '13%',
      }),
    ]);
    expect(employees.addEvent).not.toHaveBeenCalled();
    expect(documents.storeGenerated).toHaveBeenCalledWith(
      admin,
      'e1',
      expect.objectContaining({
        category: 'APPRAISAL',
        docType: 'APPRAISAL_FORM',
        replaces: null,
      }),
    );
    const pdf: Buffer = documents.storeGenerated.mock.calls[0][2].buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(v.formDocumentId).toBe('doc-1');
    expect(v.outcomeApplied).toBe(true);

    await svc.advance(admin, 'a1');
    expect(employees.recordAppraisalOutcome).toHaveBeenCalledTimes(1);
    expect(documents.storeGenerated).toHaveBeenCalledTimes(1);
  });

  it('confirms an employee on probation', async () => {
    const rows = {
      current: form({
        status: 'FINAL_APPROVAL',
        ...rated,
        actions: ['CONFIRM'],
        approvalDecision: 'APPROVED',
        employee: { ...appraisal().employee, status: 'PROBATION' },
      }),
    };
    const { svc, employees } = make(rows);
    await svc.advance(admin, 'a1');
    expect(employees.recordAppraisalOutcome.mock.calls[0][2]).toEqual([
      expect.objectContaining({ type: 'CONFIRMED' }),
    ]);
  });

  it('not approved: signs off with no outcome', async () => {
    const rows = {
      current: form({
        status: 'FINAL_APPROVAL',
        ...rated,
        actions: ['PROMOTION'],
        newDesignation: 'Lead',
        approvalDecision: 'NOT_APPROVED',
      }),
    };
    const { svc, employees } = make(rows);
    const v = await svc.advance(admin, 'a1');
    expect(v.status).toBe('SIGNED_OFF');
    expect(v.outcomeApplied).toBe(true);
    expect(employees.recordAppraisalOutcome).not.toHaveBeenCalled();
    expect(employees.addEvent).not.toHaveBeenCalled();
  });

  it('will not approve an increment without a present gross salary', async () => {
    const { svc } = make({
      current: form({
        status: 'FINAL_APPROVAL',
        ...rated,
        actions: ['INCREMENT'],
        incrementPercent: 10,
        approvalDecision: 'APPROVED',
        employee: { ...appraisal().employee, grossSalary: null },
      }),
    });
    await expect(svc.advance(admin, 'a1')).rejects.toThrow(/gross salary/);
  });

  it('signs off even when documents are disabled or the store fails, and retries the PDF later', async () => {
    const signable = () =>
      form({
        status: 'FINAL_APPROVAL',
        ...rated,
        actions: ['TRAINING_TRANSFER'],
        approvalDecision: 'APPROVED',
      });

    const off = make({ current: signable() });
    off.documents.enabled = false;
    expect((await off.svc.advance(admin, 'a1')).status).toBe('SIGNED_OFF');
    expect(off.documents.storeGenerated).not.toHaveBeenCalled();

    const rows = { current: signable() };
    const flaky = make(rows);
    flaky.documents.storeGenerated.mockRejectedValueOnce(
      new Error('store down'),
    );
    const v = await flaky.svc.advance(admin, 'a1');
    expect(v.status).toBe('SIGNED_OFF');
    expect(v.formDocumentId).toBeNull();
    const retried = await flaky.svc.advance(admin, 'a1');
    expect(retried.formDocumentId).toBe('doc-1');
    expect(flaky.documents.storeGenerated).toHaveBeenCalledTimes(2);
  });

  it('previews the form as a PDF without storing it; legacy appraisals have none', async () => {
    const { svc, documents } = make({
      current: form({ status: 'HR_REVIEW', ...rated }),
    });
    const pdf = await svc.formPdf('org', 'a1');
    expect(pdf.fileName).toBe('Appraisal form - Ada - H2 2026.pdf');
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(documents.storeGenerated).not.toHaveBeenCalled();

    await expect(
      make({ current: appraisal() }).svc.formPdf('org', 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AppraisalsService FORM_100 outcome retry', () => {
  it('never compounds an increment when the outcome landed but was not marked applied', async () => {
    const rows: { current: Row | null } = {
      current: appraisal({
        cycle: cycle({
          scoringMode: 'FORM_100',
          kpiWeight: 0,
          competencies: [{ key: 'integrity', label: 'Integrity' }],
        }),
        status: 'FINAL_APPROVAL',
        leadRatings: { integrity: 8 },
        actions: ['INCREMENT'],
        incrementPercent: 13,
        approvalDecision: 'APPROVED',
      }),
    };
    const { svc, repo, employees } = make(rows);
    // The header reads the employee as they are now, like the real query.
    repo.headerSources.mockImplementation(async (_org: string, ids: string[]) =>
      ids.map((id) => ({
        ...headerSource(id),
        grossSalary: rows.current?.employee.grossSalary ?? null,
      })),
    );
    // The events commit and move the salary...
    employees.recordAppraisalOutcome.mockImplementation(
      async (
        _p: unknown,
        _id: string,
        events: { type: string; toValue: string }[],
      ) => {
        const inc = events.find((e) => e.type === 'INCREMENT');
        if (inc && rows.current)
          rows.current = {
            ...rows.current,
            employee: {
              ...rows.current.employee,
              grossSalary: Number(inc.toValue),
            },
          };
      },
    );
    // ...but marking the outcome applied fails once.
    repo.markOutcomeApplied.mockRejectedValueOnce(new Error('db blip'));

    await expect(svc.advance(admin, 'a1')).rejects.toThrow('db blip');
    expect(rows.current?.employee.grossSalary).toBe(90400);

    await svc.advance(admin, 'a1');
    const calls = employees.recordAppraisalOutcome.mock.calls;
    expect(calls).toHaveLength(2);
    // The retry is computed on the salary frozen at sign-off (80,000), not the raised one.
    expect(calls[1][2]).toEqual([
      expect.objectContaining({
        type: 'INCREMENT',
        fromValue: '80000',
        toValue: '90400',
      }),
    ]);
  });
});

describe('AppraisalsService join-date cycles', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const person = (
    id: string,
    joinDate: string,
    status = 'ACTIVE',
    fullName = id,
  ) => ({
    id,
    managerId: 'm1',
    fullName,
    designation: 'Developer',
    status,
    joinDate: day(joinDate),
    team: { name: 'Core' },
  });
  // Half-yearly appraisals due in October 2026.
  const octCycle = (over: Record<string, unknown> = {}) =>
    cycle({
      periodBasis: 'JOIN_DATE',
      type: 'HALF_YEARLY',
      periodStart: day('2026-10-01'),
      periodEnd: day('2026-10-31'),
      status: 'DRAFT',
      ...over,
    });
  const people = [
    person('jahid', '2025-04-15'), // due 15 Oct 2026
    person('new', '2026-09-01'), // first half-yearly Sep 2027
    person('mira', '2024-10-31'), // due 31 Oct 2026 (also 30 Apr 2026, outside)
    person('prob', '2026-04-10', 'PROBATION'), // half-yearly not before Apr 2027
  ];

  it('new cycles default to JOIN_DATE; an explicit CALENDAR is kept', async () => {
    const { svc, repo } = make({ current: null });
    await svc.createCycle(admin, {
      name: 'October 2026 appraisals',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      type: 'HALF_YEARLY',
    });
    expect(repo.createCycle.mock.calls[0][0].periodBasis).toBe('JOIN_DATE');
    await svc.createCycle(admin, {
      name: 'H2',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      periodBasis: 'CALENDAR',
    });
    expect(repo.createCycle.mock.calls[1][0].periodBasis).toBe('CALENDAR');
  });

  it('locks the basis once appraisals exist', async () => {
    const { svc } = make(
      { current: null },
      {
        statusCounts: jest
          .fn()
          .mockResolvedValue([
            { cycleId: 'c1', status: 'SELF_REVIEW', count: 1 },
          ]),
      },
    );
    await expect(
      svc.updateCycle('org', 'c1', { periodBasis: 'JOIN_DATE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a default launch takes everyone due in the window, each with their own period', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        findCycle: jest.fn().mockResolvedValue(octCycle()),
        launchCandidates: jest.fn().mockResolvedValue(people),
        createAppraisals: jest.fn().mockResolvedValue(2),
      },
    );
    const r = await svc.launch('org', 'c1', {});
    const rows = repo.createAppraisals.mock.calls[0][1];
    expect(
      rows.map((x: { id: string; period: unknown }) => [x.id, x.period]),
    ).toEqual([
      [
        'jahid',
        {
          periodStart: '2026-04-15',
          periodEnd: '2026-10-14',
          dueDate: '2026-10-15',
        },
      ],
      [
        'mira',
        {
          periodStart: '2026-04-30',
          periodEnd: '2026-10-30',
          dueDate: '2026-10-31',
        },
      ],
    ]);
    expect(r).toMatchObject({ created: 2, skipped: 0, notDue: [] });
  });

  it('a confirmation cycle only takes employees still on probation', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        findCycle: jest
          .fn()
          .mockResolvedValue(octCycle({ type: 'CONFIRMATION' })),
        launchCandidates: jest
          .fn()
          .mockResolvedValue([
            person('p1', '2026-04-03', 'PROBATION'),
            person('a1', '2026-04-20', 'ACTIVE'),
          ]),
      },
    );
    await svc.launch('org', 'c1', {});
    const rows = repo.createAppraisals.mock.calls[0][1];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'p1',
      period: {
        periodStart: '2026-04-03',
        periodEnd: '2026-10-02',
        dueDate: '2026-10-03',
      },
    });
  });

  it('an explicit selection uses each latest due date by the window end and reports who is not due', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        findCycle: jest.fn().mockResolvedValue(octCycle()),
        launchCandidates: jest
          .fn()
          .mockResolvedValue([
            person('late', '2025-01-20'),
            person('new', '2026-09-01', 'PROBATION', 'Newbie'),
            person('gone', '2024-01-01', 'EXITED', 'Gone'),
          ]),
        createAppraisals: jest.fn().mockResolvedValue(1),
      },
    );
    const r = await svc.launch('org', 'c1', {
      employeeIds: ['late', 'new', 'gone'],
    });
    const rows = repo.createAppraisals.mock.calls[0][1];
    // Joined 20 Jan 2025: last half-yearly by 31 Oct 2026 was 20 Jul 2026 (a late appraisal).
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'late',
        period: {
          periodStart: '2026-01-20',
          periodEnd: '2026-07-19',
          dueDate: '2026-07-20',
        },
      }),
    ]);
    expect(r.skipped).toBe(0);
    expect(r.notDue).toEqual([
      {
        employeeId: 'new',
        employeeName: 'Newbie',
        reason: 'NOT_YET_DUE',
        firstDueDate: '2027-09-01',
      },
      {
        employeeId: 'gone',
        employeeName: 'Gone',
        reason: 'EXITED',
        firstDueDate: null,
      },
    ]);
  });

  it('refuses a launch with nobody due rather than opening an empty cycle', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        findCycle: jest.fn().mockResolvedValue(octCycle()),
        launchCandidates: jest
          .fn()
          .mockResolvedValue([person('new', '2026-09-01')]),
      },
    );
    await expect(svc.launch('org', 'c1', {})).rejects.toThrow(/Nobody is due/);
    expect(repo.createAppraisals).not.toHaveBeenCalled();
  });

  it('measures the form header’s experience to the due date', async () => {
    const { svc, repo } = make(
      { current: null },
      {
        findCycle: jest
          .fn()
          .mockResolvedValue(
            octCycle({ type: 'CONFIRMATION', scoringMode: 'FORM_100' }),
          ),
        launchCandidates: jest
          .fn()
          .mockResolvedValue([person('e1', '2026-04-03', 'PROBATION')]),
        headerSources: jest.fn().mockResolvedValue([
          {
            ...headerSource('e1'),
            joinDate: day('2026-04-03'),
          },
        ]),
      },
    );
    await svc.launch('org', 'c1', {});
    const rows = repo.createAppraisals.mock.calls[0][1];
    expect(rows[0].formHeader.experienceInCompanyMonths).toBe(6);
  });

  it('lists who is due in a window, by due date', async () => {
    const { svc, repo } = make(
      { current: null },
      { launchCandidates: jest.fn().mockResolvedValue(people) },
    );
    const r = await svc.dueEmployees('org', {
      type: 'HALF_YEARLY',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(repo.launchCandidates).toHaveBeenCalledWith('org', '2026-10-31');
    expect(r).toEqual([
      {
        employeeId: 'jahid',
        fullName: 'jahid',
        designation: 'Developer',
        teamName: 'Core',
        status: 'ACTIVE',
        joinDate: '2025-04-15',
        type: 'HALF_YEARLY',
        dueDate: '2026-10-15',
        periodStart: '2026-04-15',
        periodEnd: '2026-10-14',
      },
      expect.objectContaining({ employeeId: 'mira', dueDate: '2026-10-31' }),
    ]);
    await expect(
      svc.dueEmployees('org', {
        type: 'YEARLY',
        from: '2026-10-31',
        to: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('snapshots the KPIs over the appraisal’s own period', async () => {
    const rows = {
      current: appraisal({
        cycle: octCycle({ status: 'OPEN' }),
        periodStart: day('2026-04-15'),
        periodEnd: day('2026-10-14'),
        dueDate: day('2026-10-15'),
      }),
    };
    const { svc, summaries } = make(rows);
    const v = await svc.advance(admin, 'a1');
    expect(summaries.kpisForPeriod).toHaveBeenCalledWith('org', 'e1', {
      from: '2026-04-15',
      to: expect.any(String),
    });
    expect(v).toMatchObject({
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
      dueDate: '2026-10-15',
      cycle: { periodBasis: 'JOIN_DATE' },
    });
  });

  it('a calendar appraisal reads the cycle’s period and has no due date', async () => {
    const rows = { current: appraisal() };
    const { svc } = make(rows);
    const v = await svc.getAppraisal('org', 'a1');
    expect(v).toMatchObject({
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      dueDate: null,
      cycle: { periodBasis: 'CALENDAR' },
    });
  });
});
