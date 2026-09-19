import { ForbiddenException } from '@nestjs/common';
import { AccessScope } from '../access/access-scope';
import { TimeEntriesReportService } from './time-entries-report.service';

/**
 * The timesheet has two independent gates and BOTH must hold:
 *   1. whose timesheet you may open (`timesheetUserIds`)
 *   2. which rows it may contain (the same client scope as every other list read)
 *
 * Gate 2 is the regression these tests exist for: it used to be absent, which made
 * the timesheet the only surface that showed work the rest of the app hides, and
 * let a lead read a colleague's cross-client task names by adding them to a team.
 */
describe('TimeEntriesReportService.timesheet row scoping', () => {
  function setup() {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: queryRaw } as never;
    return { svc: new TimeEntriesReportService(prisma), queryRaw };
  }

  /** The composed Prisma.Sql the service handed to $queryRaw. */
  function lastSql(queryRaw: jest.Mock) {
    const arg = queryRaw.mock.calls[0][0];
    return { text: String(arg.sql).replace(/\s+/g, ' '), values: arg.values as unknown[] };
  }

  const scoped = (clients: [string, 'LEAD' | 'MEMBER'][], self: string): AccessScope => ({
    kind: 'scoped',
    clients: new Map(clients),
    ledUserClickupIds: [],
    selfClickupId: self,
    ledTeamIds: [],
  });

  it('filters a scoped viewer’s own timesheet to the clients their teams own', async () => {
    const { svc, queryRaw } = setup();
    await svc.timesheet('u1', undefined, undefined, scoped([['acme', 'MEMBER']], 'u1'));
    const { text, values } = lastSql(queryRaw);
    expect(text).toContain('scope_client_option_id');
    expect(values).toContain('u1');
    expect(values.some((v) => Array.isArray(v) && (v as string[]).includes('acme'))).toBe(true);
  });

  it('a scoped viewer with no clients at all matches nothing, rather than everything', async () => {
    const { svc, queryRaw } = setup();
    await svc.timesheet('u1', undefined, undefined, scoped([], 'u1'));
    // `taskScopeSql` emits a literal FALSE for an empty client list — default-deny.
    expect(lastSql(queryRaw).text).toContain('FALSE');
  });

  it('leaves an unrestricted viewer’s timesheet unfiltered (Owner/Admin, or any MEMBER while the flag is off)', async () => {
    const { svc, queryRaw } = setup();
    await svc.timesheet('u1', undefined, undefined, { kind: 'unrestricted', canEdit: false });
    const { text } = lastSql(queryRaw);
    expect(text).toContain('TRUE');
    expect(text).not.toContain('scope_client_option_id = ANY');
  });

  it('still rejects a timesheet the viewer may not open at all, before querying', async () => {
    const { svc, queryRaw } = setup();
    await expect(svc.timesheet('someone-else', undefined, undefined, scoped([['acme', 'LEAD']], 'u1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
