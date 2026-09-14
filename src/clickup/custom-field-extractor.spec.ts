import { CustomFieldExtractor } from './custom-field-extractor';
import { ClickUpTask } from './clickup.types';

describe('CustomFieldExtractor', () => {
  const extractor = new CustomFieldExtractor();

  function taskWith(custom_fields: ClickUpTask['custom_fields']): ClickUpTask {
    return { custom_fields } as ClickUpTask;
  }

  it('trims trailing/leading whitespace from a resolved client dropdown name', () => {
    // Regression: a ClickUp dropdown option literally named "Call A tradie Pty "
    // (trailing space) was stored verbatim. The facet counted it (GROUP BY), but
    // the exact-match filter trims the value it sends, so `client IN (...)` missed
    // every space-padded row and the Tasks/Time Entries pages showed nothing.
    const task = taskWith([
      {
        name: 'Client',
        type: 'drop_down',
        value: 0,
        type_config: { options: [{ orderindex: 0, name: 'Call A tradie Pty ' }] },
      },
    ]);
    expect(extractor.extract(task).client).toBe('Call A tradie Pty');
  });

  it('trims whitespace from executive, department, and sprint name text fields', () => {
    const task = taskWith([
      { name: 'Executive', type: 'short_text', value: '  Alice  ' },
      { name: 'Department', type: 'short_text', value: 'Finance ' },
      { name: 'Sprint', type: 'short_text', value: ' Sprint 183 ' },
    ]);
    const out = extractor.extract(task);
    expect(out.executiveName).toBe('Alice');
    expect(out.department).toBe('Finance');
    expect(out.sprintName).toBe('Sprint 183');
  });

  it('maps a whitespace-only string field to null rather than an empty string', () => {
    const task = taskWith([{ name: 'Department', type: 'short_text', value: '   ' }]);
    expect(extractor.extract(task).department).toBeNull();
  });

  it('leaves a clean client name unchanged', () => {
    const task = taskWith([
      {
        name: 'Client',
        type: 'drop_down',
        value: 1,
        type_config: { options: [{ orderindex: 1, name: 'Acme Corp' }] },
      },
    ]);
    expect(extractor.extract(task).client).toBe('Acme Corp');
  });

  describe('sub-project', () => {
    it('resolves a labels field (array of option ids) to option labels', () => {
      const task = taskWith([
        {
          name: 'Sub-Project',
          type: 'labels',
          value: ['uuid-b', 'uuid-a'],
          type_config: { options: [{ id: 'uuid-a', label: 'Mobile App' }, { id: 'uuid-b', label: 'Website' }] },
        },
      ]);
      expect(extractor.extract(task).subProjects).toEqual(['Website', 'Mobile App']);
    });

    it('trims labels and drops unresolvable ids, blanks and duplicates', () => {
      const task = taskWith([
        {
          name: 'Sub-Project',
          type: 'labels',
          value: ['a', 'missing', 'b', 'a', 'c'],
          type_config: { options: [{ id: 'a', label: ' Website ' }, { id: 'b', label: 'Website' }, { id: 'c', label: '  ' }] },
        },
      ]);
      expect(extractor.extract(task).subProjects).toEqual(['Website']);
    });

    it('falls back to the option name when a labels option has no label', () => {
      const task = taskWith([
        { name: 'Sub-Project', type: 'labels', value: ['a'], type_config: { options: [{ id: 'a', name: 'Portal' }] } },
      ]);
      expect(extractor.extract(task).subProjects).toEqual(['Portal']);
    });

    it('resolves a dropdown variant by orderindex', () => {
      const task = taskWith([
        { name: 'Sub-Project', type: 'drop_down', value: 2, type_config: { options: [{ orderindex: 2, name: 'Portal' }] } },
      ]);
      expect(extractor.extract(task).subProjects).toEqual(['Portal']);
    });

    it('resolves a dropdown variant whose value is the option id', () => {
      const task = taskWith([
        { name: 'Sub-Project', type: 'drop_down', value: 'opt-1', type_config: { options: [{ id: 'opt-1', orderindex: 0, name: 'Portal' }] } },
      ]);
      expect(extractor.extract(task).subProjects).toEqual(['Portal']);
    });

    it('stores a text variant as a single trimmed value', () => {
      const task = taskWith([{ name: 'Sub-Project', type: 'short_text', value: ' Portal ' }]);
      expect(extractor.extract(task).subProjects).toEqual(['Portal']);
    });

    it.each(['Sub-Project', 'Sub Project', 'subproject', 'SUB_PROJECT'])('matches the field name "%s"', (name) => {
      const task = taskWith([{ name, type: 'short_text', value: 'Portal' }]);
      expect(extractor.extract(task).subProjects).toEqual(['Portal']);
    });

    it('does not treat a plain "Project" field as a sub-project', () => {
      const task = taskWith([{ name: 'Project', type: 'short_text', value: 'Portal' }]);
      expect(extractor.extract(task).subProjects).toEqual([]);
    });

    it('returns an empty list when the field is absent or unset', () => {
      expect(extractor.extract(taskWith([])).subProjects).toEqual([]);
      expect(extractor.extract(taskWith([{ name: 'Sub-Project', type: 'labels', value: [] }])).subProjects).toEqual([]);
      expect(extractor.extract(taskWith([{ name: 'Sub-Project', type: 'labels' }])).subProjects).toEqual([]);
    });
  });
});
