import { ClickupNormalizer } from '../src/clickup/clickup-normalizer';
import { CustomFieldExtractor } from '../src/clickup/custom-field-extractor';

function makeNormalizer() {
  return new ClickupNormalizer(new CustomFieldExtractor());
}

describe('ClickupNormalizer.normalizeTimeEntry', () => {
  it('converts millisecond duration to decimal hours', () => {
    const n = makeNormalizer();
    const entry = n.normalizeTimeEntry({ id: 'te-1', duration: 3_600_000 } as any);
    expect(entry.durationHours).toBe(1);
  });

  it('clamps negative durations (running timers) to 0 so cost cannot go negative', () => {
    const n = makeNormalizer();
    const entry = n.normalizeTimeEntry({ id: 'te-2', duration: -3_600_000 } as any);
    expect(entry.durationHours).toBe(0);
  });

  it('throws when the time entry has no id', () => {
    const n = makeNormalizer();
    expect(() => n.normalizeTimeEntry({} as any)).toThrow(/missing id/);
  });
});

describe('ClickupNormalizer.normalizeTask', () => {
  it('maps core fields and treats a top-level task as a parent (parentTaskId=null)', () => {
    const n = makeNormalizer();
    const task = n.normalizeTask({
      id: '86abc',
      name: 'Build feature',
      status: { status: 'in progress', type: 'custom', color: '#fff' },
      space: { id: 'sp1', name: 'R&D' },
    } as any);

    expect(task.taskId).toBe('86abc');
    expect(task.parentTaskId).toBeNull();
    expect(task.taskName).toBe('Build feature');
    expect(task.status).toBe('in progress');
    expect(task.spaceId).toBe('sp1');
  });

  it('records a subtask\'s ClickUp parent in parentTaskId', () => {
    const n = makeNormalizer();
    const sub = n.normalizeTask({ id: 'sub1', name: 'Subtask', parent: '86abc' } as any);
    expect(sub.parentTaskId).toBe('86abc');
  });

  it('falls back to "Untitled" when the task has no name', () => {
    const n = makeNormalizer();
    const task = n.normalizeTask({ id: 'x1' } as any);
    expect(task.taskName).toBe('Untitled');
  });

  it('throws when the task has no id', () => {
    const n = makeNormalizer();
    expect(() => n.normalizeTask({} as any)).toThrow(/missing id/);
  });
});
