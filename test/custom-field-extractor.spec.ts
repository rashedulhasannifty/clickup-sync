import { CustomFieldExtractor } from '../src/clickup/custom-field-extractor';

describe('CustomFieldExtractor', () => {
  it('resolves client dropdown and sprint points', () => {
    const extractor = new CustomFieldExtractor();
    const result = extractor.extract({ id: '1', points: 2, custom_fields: [
      { name: 'Client', type: 'drop_down', value: 1, type_config: { options: [{ orderindex: 1, name: 'Acme' }] } },
      { name: 'Sprint Points', value: 5 },
    ] });
    expect(result.client).toBe('Acme');
    expect(result.sprintPoints).toBe(5);
  });
});
