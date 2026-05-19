import { buildTimeEntriesQuery, extractAssigneeIds } from './time-entries.util';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

describe('buildTimeEntriesQuery', () => {
  it('always includes task_id', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery('86abc', {}));
    expect(p.get('task_id')).toBe('86abc');
  });

  it('joins multiple assignee ids with a comma (ClickUp returns only the token owner without this)', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery('t', { assigneeIds: ['49377103', '123'] }));
    expect(p.get('assignee')).toBe('49377103,123');
  });

  it('omits the assignee param entirely when no assignees are given', () => {
    expect(new URLSearchParams(buildTimeEntriesQuery('t', {})).has('assignee')).toBe(false);
    expect(new URLSearchParams(buildTimeEntriesQuery('t', { assigneeIds: [] })).has('assignee')).toBe(false);
  });

  it('passes through an explicit start/end window', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery('t', { startDate: 1000, endDate: 2000 }));
    expect(p.get('start_date')).toBe('1000');
    expect(p.get('end_date')).toBe('2000');
  });

  it('always sends an explicit window (defaults to a 365-day lookback) since ClickUp defaults to today only', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery('t', {}));
    const start = Number(p.get('start_date'));
    const end = Number(p.get('end_date'));
    expect(p.has('start_date')).toBe(true);
    expect(p.has('end_date')).toBe(true);
    expect(end - start).toBe(YEAR_MS);
  });
});

describe('extractAssigneeIds', () => {
  it('maps task assignee ids to strings', () => {
    expect(extractAssigneeIds({ assignees: [{ id: 49377103 }, { id: '123' }] })).toEqual(['49377103', '123']);
  });

  it('returns [] for a task with no assignees', () => {
    expect(extractAssigneeIds({ assignees: [] })).toEqual([]);
    expect(extractAssigneeIds({})).toEqual([]);
  });

  it('drops assignees without an id', () => {
    expect(extractAssigneeIds({ assignees: [{ id: null }, { username: 'x' }, { id: 5 }] })).toEqual(['5']);
  });
});
