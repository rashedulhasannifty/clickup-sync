import { buildTimeEntriesQuery, resolveTimeEntriesWindow } from './time-entries.util';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

describe('resolveTimeEntriesWindow', () => {
  it('passes through an explicit start/end window unchanged', () => {
    expect(resolveTimeEntriesWindow({ startDate: 1000, endDate: 2000 })).toEqual({ startMs: 1000, endMs: 2000 });
  });

  it('defaults the end to now and the start to a 365-day lookback', () => {
    const { startMs, endMs } = resolveTimeEntriesWindow({});
    expect(endMs).toBeGreaterThan(0);
    expect(endMs - startMs).toBe(YEAR_MS);
  });

  it('keeps the query string window in lock-step with the resolved window', () => {
    const w = resolveTimeEntriesWindow({ startDate: 5, endDate: 9 });
    const p = new URLSearchParams(buildTimeEntriesQuery('t', { startDate: 5, endDate: 9 }));
    expect(p.get('start_date')).toBe(String(w.startMs));
    expect(p.get('end_date')).toBe(String(w.endMs));
  });
});

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

