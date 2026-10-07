import { buildCompanyReport, classifyExpiry, computeChecklist, todayIsoDhaka, type ReportDocument, type ReportEmployee } from './document-report';

const TODAY = '2026-10-07';

describe('todayIsoDhaka', () => {
  it('rolls to the next calendar day after 18:00 UTC (Dhaka is UTC+6)', () => {
    expect(todayIsoDhaka(new Date('2026-10-07T17:59:00Z'))).toBe('2026-10-07');
    expect(todayIsoDhaka(new Date('2026-10-07T18:00:00Z'))).toBe('2026-10-08');
  });
});

describe('classifyExpiry', () => {
  it('has no status without an expiry date', () => {
    expect(classifyExpiry(null, TODAY)).toEqual({ status: 'none', daysLeft: null });
  });

  it('treats the expiry day itself as expiring, not expired', () => {
    expect(classifyExpiry('2026-10-07', TODAY)).toEqual({ status: 'expiring', daysLeft: 0 });
  });

  it('is expired the day after', () => {
    expect(classifyExpiry('2026-10-06', TODAY)).toEqual({ status: 'expired', daysLeft: -1 });
  });

  it('is expiring through today + 30 and valid from today + 31', () => {
    expect(classifyExpiry('2026-11-06', TODAY)).toEqual({ status: 'expiring', daysLeft: 30 });
    expect(classifyExpiry('2026-11-07', TODAY)).toEqual({ status: 'valid', daysLeft: 31 });
  });

  it('counts across month and year ends', () => {
    expect(classifyExpiry('2027-01-05', '2026-12-31')).toEqual({ status: 'expiring', daysLeft: 5 });
  });
});

const doc = (id: string, docType: string, over: Partial<ReportDocument> = {}): ReportDocument => ({
  id,
  category: 'IDENTITY',
  docType,
  fileName: `${id}.pdf`,
  contentType: 'application/pdf',
  sizeBytes: 10,
  version: 1,
  expiresOn: null,
  visibility: 'HR_ONLY',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const complete = (prefix: string): ReportDocument[] => [
  doc(`${prefix}-nid`, 'NATIONAL_ID'),
  doc(`${prefix}-contract`, 'SIGNED_CONTRACT', { category: 'EMPLOYMENT' }),
  doc(`${prefix}-edu`, 'EDUCATION_CERTIFICATE', { category: 'EDUCATION' }),
  doc(`${prefix}-emg`, 'EMERGENCY_CONTACT_FORM', { category: 'PERSONAL' }),
];

describe('computeChecklist', () => {
  it('flags every required item missing for an employee with no documents', () => {
    const c = computeChecklist([], TODAY);
    expect(c.map((i) => i.satisfied)).toEqual([false, false, false, false]);
    expect(c.map((i) => i.key)).toEqual(['IDENTITY_PROOF', 'SIGNED_CONTRACT', 'EDUCATION_CERTIFICATE', 'EMERGENCY_CONTACT_FORM']);
  });

  it('accepts a NID or a passport for the identity item', () => {
    expect(computeChecklist([doc('p', 'PASSPORT')], TODAY)[0]).toMatchObject({ satisfied: true, documentId: 'p' });
    expect(computeChecklist([doc('n', 'NATIONAL_ID')], TODAY)[0]).toMatchObject({ satisfied: true, documentId: 'n' });
    expect(computeChecklist([doc('w', 'WORK_PERMIT')], TODAY)[0].satisfied).toBe(false);
  });

  it('lets an expired document still satisfy the item, flagged expired', () => {
    expect(computeChecklist([doc('n', 'NATIONAL_ID', { expiresOn: '2026-01-01' })], TODAY)[0]).toMatchObject({
      satisfied: true,
      expiry: 'expired',
    });
  });

  it('prefers a non-expired document when several match', () => {
    const c = computeChecklist(
      [doc('old', 'NATIONAL_ID', { expiresOn: '2026-01-01' }), doc('new', 'PASSPORT', { expiresOn: '2031-02-14' })],
      TODAY,
    );
    expect(c[0]).toMatchObject({ documentId: 'new', expiry: 'valid' });
  });
});

describe('buildCompanyReport', () => {
  const employees: ReportEmployee[] = [
    {
      id: 'e1',
      fullName: 'Ayesha Khan',
      status: 'ACTIVE',
      documents: [...complete('a').filter((d) => d.docType !== 'NATIONAL_ID'), doc('a-nid', 'NATIONAL_ID', { expiresOn: '2026-10-28' })],
    },
    {
      id: 'e2',
      fullName: 'Rafiq Islam',
      status: 'ACTIVE',
      documents: [...complete('r'), doc('r-permit', 'WORK_PERMIT', { expiresOn: '2026-10-02', fileName: 'Work permit.pdf' })],
    },
    { id: 'e3', fullName: 'Farhan Hossain', status: 'PROBATION', documents: [doc('f-nid', 'NATIONAL_ID'), doc('f-edu', 'EDUCATION_CERTIFICATE', { category: 'EDUCATION' })] },
    // Left the company: expired/missing must not nag, but the files still count in the total.
    {
      id: 'e4',
      fullName: 'Old Timer',
      status: 'EXITED',
      documents: [doc('o-nid', 'NATIONAL_ID', { expiresOn: '2020-01-01' })],
    },
  ];

  it('counts the whole set, excluding exited employees from the alerts', () => {
    const { counts } = buildCompanyReport(employees, TODAY);
    expect(counts.total).toBe(4 + 5 + 2 + 1);
    expect(counts.expiring).toBe(1); // Ayesha's NID
    expect(counts.expired).toBe(1); // Rafiq's permit; the exited employee's NID is not counted
    // Farhan lacks contract + emergency form; Old Timer is exited and ignored.
    expect(counts.missing).toBe(2);
    expect(counts.missingEmployees).toBe(1);
  });

  it('counts do not change with the status filter', () => {
    const all = buildCompanyReport(employees, TODAY).counts;
    expect(buildCompanyReport(employees, TODAY, { status: 'expired' }).counts).toEqual(all);
    expect(buildCompanyReport(employees, TODAY, { status: 'missing', category: 'PERSONAL' }).counts).toEqual(all);
  });

  it('lists every document by default, newest first', () => {
    const { rows } = buildCompanyReport(employees, TODAY);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.kind === 'document')).toBe(true);
  });

  it('status=expiring lists only non-exited expiring documents, soonest first', () => {
    const { rows } = buildCompanyReport(employees, TODAY, { status: 'expiring' });
    expect(rows.map((r) => r.kind === 'document' && r.id)).toEqual(['a-nid']);
  });

  it('status=expired excludes the exited employee', () => {
    const { rows } = buildCompanyReport(employees, TODAY, { status: 'expired' });
    expect(rows.map((r) => r.kind === 'document' && r.id)).toEqual(['r-permit']);
  });

  it('status=missing returns one row per missing required item, never for exited employees', () => {
    const { rows } = buildCompanyReport(employees, TODAY, { status: 'missing' });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind === 'missing' && `${r.employee.fullName}:${r.requirement.key}`)).toEqual([
      'Farhan Hossain:EMERGENCY_CONTACT_FORM',
      'Farhan Hossain:SIGNED_CONTRACT',
    ]);
  });

  it('filters by category, employee and search', () => {
    expect(buildCompanyReport(employees, TODAY, { category: 'EDUCATION' }).rows).toHaveLength(3);
    expect(buildCompanyReport(employees, TODAY, { employeeId: 'e3' }).rows).toHaveLength(2);
    expect(buildCompanyReport(employees, TODAY, { search: 'permit' }).rows).toHaveLength(1);
    expect(buildCompanyReport(employees, TODAY, { search: 'ayesha' }).rows).toHaveLength(4);
    expect(buildCompanyReport(employees, TODAY, { status: 'missing', search: 'contract' }).rows).toHaveLength(1);
    expect(buildCompanyReport(employees, TODAY, { status: 'missing', category: 'IDENTITY' }).rows).toHaveLength(0);
  });
});
