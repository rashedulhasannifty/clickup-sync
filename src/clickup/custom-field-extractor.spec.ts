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
});
