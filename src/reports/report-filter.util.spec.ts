import { csvList, taskSearchOr, timeEntryTaskSearchOr } from './report-filter.util';

/** The task column each clause targets, e.g. `{ taskName: {...} }` -> 'taskName'. */
const fieldsOf = (clauses: Record<string, unknown>[]) => clauses.map((c) => Object.keys(c)[0]).sort();

describe('taskSearchOr', () => {
  it('searches every short task column the dashboard exposes as a filter', () => {
    expect(fieldsOf(taskSearchOr('x'))).toEqual(
      [
        'assigneesEmails',
        'assigneesNames',
        'client',
        'department',
        'executiveName',
        'listName',
        'spaceName',
        'sprintName',
        'taskId',
        'taskName',
      ].sort(),
    );
  });

  it('matches case-insensitively on a substring', () => {
    taskSearchOr('Clean').forEach((clause) => {
      expect(Object.values(clause)[0]).toEqual({ contains: 'Clean', mode: 'insensitive' });
    });
  });

  it('never searches description or raw JSON (ILIKE on those is expensive)', () => {
    const fields = fieldsOf(taskSearchOr('x'));
    expect(fields).not.toContain('description');
    expect(fields).not.toContain('markdownDescription');
    expect(fields).not.toContain('raw');
  });
});

describe('timeEntryTaskSearchOr', () => {
  it('reaches the task through the relation', () => {
    timeEntryTaskSearchOr('x').forEach((clause) => {
      expect(Object.keys(clause)).toEqual(['task']);
    });
  });

  it('covers EXACTLY the same task columns as the Tasks page', () => {
    // The regression this guards: Tasks searched ten task columns while Time
    // Entries searched only task.taskName, so the same query resolved a
    // different task set on each page — and a task renamed in ClickUp could
    // silently drop out of one page's results while staying in the other's.
    const viaRelation = timeEntryTaskSearchOr('x').map(
      (c) => Object.keys((c as { task: Record<string, unknown> }).task)[0],
    );
    expect(viaRelation.sort()).toEqual(fieldsOf(taskSearchOr('x')));
  });

  it('passes the query through unchanged', () => {
    const [first] = timeEntryTaskSearchOr('Clean') as { task: Record<string, unknown> }[];
    expect(Object.values(first.task)[0]).toEqual({ contains: 'Clean', mode: 'insensitive' });
  });
});

describe('csvList', () => {
  it('treats absent, empty, and commas-only as no selection', () => {
    expect(csvList(undefined)).toBeUndefined();
    expect(csvList('')).toBeUndefined();
    expect(csvList(' , , ')).toBeUndefined();
  });

  it('trims, drops blanks, and de-duplicates', () => {
    expect(csvList(' Acme , Beta ,, Acme ')).toEqual(['Acme', 'Beta']);
  });

  it('parses a pre-existing single-value deep-link as a one-element list', () => {
    expect(csvList('Acme')).toEqual(['Acme']);
  });
});
