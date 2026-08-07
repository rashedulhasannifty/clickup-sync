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
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', startDate: 5, endDate: 9 }));
    expect(p.get('start_date')).toBe(String(w.startMs));
    expect(p.get('end_date')).toBe(String(w.endMs));
  });
});

describe('buildTimeEntriesQuery', () => {
  it('includes task_id when a taskId is given, and no space_id', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: '86abc' }));
    expect(p.get('task_id')).toBe('86abc');
    expect(p.get('space_id')).toBeNull();
  });

  it('includes space_id when a spaceId is given, and no task_id', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ spaceId: '3577824' }));
    expect(p.get('space_id')).toBe('3577824');
    expect(p.get('task_id')).toBeNull();
  });

  it('joins multiple assignee ids with a comma (ClickUp returns only the token owner without this)', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', assigneeIds: ['a', 'b'] }));
    expect(p.get('assignee')).toBe('a,b');
  });

  it('omits assignee when the list is empty', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', assigneeIds: [] }));
    expect(p.get('assignee')).toBeNull();
  });

  it('always emits the resolved window', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', startDate: 5, endDate: 9 }));
    expect(p.get('start_date')).toBe('5');
    expect(p.get('end_date')).toBe('9');
  });
});

