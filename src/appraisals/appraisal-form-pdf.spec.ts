import { sniffFileType } from '../documents/file-sniff';
import { buildFormHeader } from './appraisal-header';
import { formPdfFileName, renderAppraisalFormPdf } from './appraisal-form-pdf';
import { FORM_CRITERIA, gradePolicy } from './appraisal-score';
import type { AppraisalView } from './appraisals.types';

function view(over: Partial<AppraisalView> = {}): AppraisalView {
  const ratings = Object.fromEntries(
    FORM_CRITERIA.map((c, i) => [c.key, i % 2 ? 8 : 10]),
  );
  return {
    id: 'a1',
    cycle: {
      id: 'c1',
      name: 'H2 2026',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      status: 'OPEN',
      type: 'HALF_YEARLY',
      scoringMode: 'FORM_100',
      kpiWeight: 0,
      competencies: FORM_CRITERIA.map((c) => ({ ...c })),
      counts: {
        total: 1,
        SELF_REVIEW: 0,
        LEAD_REVIEW: 0,
        CALIBRATION: 0,
        DEPT_HEAD_REVIEW: 0,
        HR_REVIEW: 0,
        FINAL_APPROVAL: 0,
        SIGNED_OFF: 1,
      },
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    employee: {
      id: 'e1',
      fullName: 'Ada Lovelace',
      designation: 'Assistant Manager',
      teamName: null,
      employeeCode: null,
      clickupLinked: true,
    },
    reviewerId: null,
    reviewerName: null,
    status: 'SIGNED_OFF',
    selfRatings: {},
    selfComment: null,
    leadRatings: ratings,
    leadComment: 'Strong half. Recommend a 13% raise.',
    strengths: null,
    improvements: null,
    goals: null,
    recommendation: null,
    newDesignation: null,
    calibrationNote: null,
    calibratedScore: null,
    actions: ['CONFIRM', 'INCREMENT'],
    incrementPercent: 13,
    trainingPlan: 'Leadership course in Q1.',
    deptHeadComment: 'Agreed.',
    hrComment: 'Within band.',
    approvalDecision: 'APPROVED',
    approvalComment: 'Approved.',
    formHeader: null,
    steps: [
      { status: 'SELF_REVIEW', byUserId: null, byName: null, at: null },
      {
        status: 'LEAD_REVIEW',
        byUserId: 'u1',
        byName: 'Grace',
        at: '2026-12-01T00:00:00.000Z',
      },
      {
        status: 'DEPT_HEAD_REVIEW',
        byUserId: 'u2',
        byName: 'Linus',
        at: '2026-12-02T00:00:00.000Z',
      },
      {
        status: 'HR_REVIEW',
        byUserId: 'u3',
        byName: 'Margaret',
        at: '2026-12-03T00:00:00.000Z',
      },
      {
        status: 'FINAL_APPROVAL',
        byUserId: 'u4',
        byName: 'Barbara',
        at: '2026-12-04T00:00:00.000Z',
      },
      {
        status: 'SIGNED_OFF',
        byUserId: 'u4',
        byName: 'Barbara',
        at: '2026-12-04T00:00:00.000Z',
      },
    ],
    formDocumentId: null,
    kpiSnapshot: null,
    score: {
      mode: 'FORM_100',
      outOf: 100,
      final: 90,
      computed: 90,
      kpiPart: null,
      competencyPart: null,
      partial: false,
      calibrated: false,
      basedOn: ['competencies'],
      kpiWeight: 0,
      grade: 'B',
      policy: gradePolicy('B'),
      kpiReference: 78,
      kpiReferencePartial: false,
      ratedCount: 10,
      criteriaCount: 10,
    },
    editableFields: [],
    advanceBlockers: [],
    canSendBack: false,
    signedOffAt: '2026-12-04T00:00:00.000Z',
    outcomeApplied: true,
    previous: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-12-04T00:00:00.000Z',
    ...over,
  };
}

const header = (name = 'Ada Lovelace') =>
  buildFormHeader({
    employee: {
      fullName: name,
      concernName: 'Nifty IT Solution Ltd',
      designation: 'Assistant Manager',
      department: 'Engineering',
      joinDate: '2023-03-15',
      exitDate: null,
      academicQualification: 'BSc in CSE',
      experienceBeforeJoiningMonths: 30,
      startingSalary: 50000,
      grossSalary: 80000,
    },
    events: [
      {
        type: 'INCREMENT',
        effectiveDate: '2026-01-01',
        fromValue: '70000',
        toValue: '80000',
      },
    ],
    companyName: 'Nifty IT Solution',
    today: '2026-12-04',
    capturedAt: '2026-12-04T00:00:00.000Z',
  });

describe('renderAppraisalFormPdf', () => {
  it('produces a real PDF that the documents module accepts by magic bytes', async () => {
    const pdf = await renderAppraisalFormPdf({
      view: view(),
      header: header(),
      generatedOn: '2026-12-04',
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
    expect(sniffFileType(pdf)?.contentType).toBe('application/pdf');
  });

  it('embeds the Bengali-capable font for a Bengali name and never uses Helvetica', async () => {
    const pdf = await renderAppraisalFormPdf({
      view: view({
        employee: { ...view().employee, fullName: 'রাশেদুল হাসান' },
      }),
      header: header('রাশেদুল হাসান'),
      generatedOn: '2026-12-04',
    });
    const text = pdf.toString('latin1');
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+HindSiliguri-Regular/);
    expect(text).not.toContain('Helvetica');
  });

  it('renders a preview of an unfinished form and a long form over several pages', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      key: `c${i}`,
      label: `Criterion ${i + 1}`,
      description: 'A long description. '.repeat(20),
    }));
    const pdf = await renderAppraisalFormPdf({
      view: view({
        status: 'HR_REVIEW',
        signedOffAt: null,
        approvalDecision: null,
        cycle: { ...view().cycle, competencies: many },
        leadRatings: {},
        score: {
          ...view().score,
          final: null,
          grade: null,
          policy: null,
          criteriaCount: 12,
          ratedCount: 0,
          kpiReference: null,
        },
      }),
      header: header(),
      generatedOn: '2026-12-04',
    });
    expect(sniffFileType(pdf)?.contentType).toBe('application/pdf');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [])
      .length;
    expect(pages).toBeGreaterThan(1);
  });

  it('names the file after the employee and cycle', () => {
    expect(formPdfFileName(view())).toBe(
      'Appraisal form - Ada Lovelace - H2 2026.pdf',
    );
  });
});
