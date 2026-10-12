import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCycleDto } from './cycle.dto';
import { UpdateAppraisalDto } from './update-appraisal.dto';

const errorsOf = async <T extends object>(cls: new () => T, body: object) =>
  (
    await validate(plainToInstance(cls, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((e) => e.property);

describe('UpdateAppraisalDto (FORM_100 fields)', () => {
  it('accepts the form fields', async () => {
    expect(
      await errorsOf(UpdateAppraisalDto, {
        leadRatings: { job_knowledge: 8 },
        actions: ['CONFIRM', 'INCREMENT', 'TRAINING_TRANSFER'],
        incrementPercent: 13.5,
        trainingPlan: 'Course',
        deptHeadComment: 'ok',
        hrComment: 'ok',
        approvalDecision: 'NOT_APPROVED',
        approvalComment: 'later',
      }),
    ).toEqual([]);
  });
  it('refuses unknown or repeated actions', async () => {
    expect(await errorsOf(UpdateAppraisalDto, { actions: ['FIRE'] })).toEqual([
      'actions',
    ]);
    expect(
      await errorsOf(UpdateAppraisalDto, { actions: ['CONFIRM', 'CONFIRM'] }),
    ).toEqual(['actions']);
    expect(await errorsOf(UpdateAppraisalDto, { actions: 'CONFIRM' })).toEqual([
      'actions',
    ]);
  });
  it('bounds the increment percent', async () => {
    expect(
      await errorsOf(UpdateAppraisalDto, { incrementPercent: -1 }),
    ).toEqual(['incrementPercent']);
    expect(
      await errorsOf(UpdateAppraisalDto, { incrementPercent: 101 }),
    ).toEqual(['incrementPercent']);
    expect(
      await errorsOf(UpdateAppraisalDto, { incrementPercent: 12.345 }),
    ).toEqual(['incrementPercent']);
    expect(
      await errorsOf(UpdateAppraisalDto, { incrementPercent: null }),
    ).toEqual([]);
  });
  it('accepts only APPROVED / NOT_APPROVED as the decision', async () => {
    expect(
      await errorsOf(UpdateAppraisalDto, { approvalDecision: 'MAYBE' }),
    ).toEqual(['approvalDecision']);
    expect(
      await errorsOf(UpdateAppraisalDto, { approvalDecision: null }),
    ).toEqual([]);
  });
  it('leaves rating VALUES to the service (it knows the cycle’s scale) but wants an object', async () => {
    // 2/4/6/8/10 vs 1-5 depends on the cycle, so parseRatings checks values; see appraisal-form.spec.
    expect(await errorsOf(UpdateAppraisalDto, { leadRatings: 8 })).toEqual([
      'leadRatings',
    ]);
  });
});

describe('UpdateAppraisalDto (dates and effective date)', () => {
  it('accepts date-only due date, period and a custom effective date', async () => {
    expect(
      await errorsOf(UpdateAppraisalDto, {
        dueDate: '2026-01-15',
        periodStart: '2025-07-15',
        periodEnd: '2026-01-14',
        effectiveDateMode: 'CUSTOM',
        effectiveDate: '2026-02-01',
      }),
    ).toEqual([]);
    expect(
      await errorsOf(UpdateAppraisalDto, {
        effectiveDateMode: null,
        effectiveDate: null,
      }),
    ).toEqual([]);
  });
  it('refuses timestamps, impossible dates and an unknown mode', async () => {
    expect(
      await errorsOf(UpdateAppraisalDto, { dueDate: '2026-01-15T00:00:00Z' }),
    ).toEqual(['dueDate']);
    expect(
      await errorsOf(UpdateAppraisalDto, { periodStart: '2026-02-30' }),
    ).toEqual(['periodStart']);
    expect(await errorsOf(UpdateAppraisalDto, { periodEnd: 'soon' })).toEqual([
      'periodEnd',
    ]);
    expect(
      await errorsOf(UpdateAppraisalDto, { effectiveDateMode: 'TODAY' }),
    ).toEqual(['effectiveDateMode']);
    expect(
      await errorsOf(UpdateAppraisalDto, { effectiveDate: '15/01/2026' }),
    ).toEqual(['effectiveDate']);
  });
});

describe('CreateCycleDto', () => {
  const base = {
    name: 'H2 2026',
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
  };
  it('takes a type, a scoring mode and criteria with descriptions', async () => {
    expect(
      await errorsOf(CreateCycleDto, {
        ...base,
        type: 'CONFIRMATION',
        scoringMode: 'FORM_100',
        competencies: [
          { key: 'a', label: 'A', description: 'What A measures' },
        ],
      }),
    ).toEqual([]);
  });
  it('refuses an unknown type or mode and an over-long description', async () => {
    expect(
      await errorsOf(CreateCycleDto, { ...base, type: 'QUARTERLY' }),
    ).toEqual(['type']);
    expect(
      await errorsOf(CreateCycleDto, { ...base, scoringMode: 'OTHER' }),
    ).toEqual(['scoringMode']);
    expect(
      await errorsOf(CreateCycleDto, {
        ...base,
        competencies: [{ key: 'a', label: 'A', description: 'x'.repeat(1001) }],
      }),
    ).toEqual(['competencies']);
  });
});
