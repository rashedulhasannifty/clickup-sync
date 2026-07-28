import { CustomFieldExtractor } from '../src/clickup/custom-field-extractor';

const extractor = new CustomFieldExtractor();

describe('CustomFieldExtractor', () => {
  it('resolves client dropdown and sprint points', () => {
    const result = extractor.extract({ id: '1', points: 2, custom_fields: [
      { name: 'Client', type: 'drop_down', value: 1, type_config: { options: [{ orderindex: 1, name: 'Acme' }] } },
      { name: 'Sprint Points', value: 5 },
    ] } as any);
    expect(result.client).toBe('Acme');
    expect(result.sprintPoints).toBe(5);
  });

  it('extracts executive name and department (substring match)', () => {
    const result = extractor.extract({ id: '1', custom_fields: [
      { name: 'Account Executive', value: 'Jane Doe' },
      { name: 'Department', value: 'Engineering' },
    ] } as any);
    expect(result.executiveName).toBe('Jane Doe');
    expect(result.department).toBe('Engineering');
  });

  it('extracts cost and estimation, including the "estimate" alias', () => {
    const cost = extractor.extract({ id: '1', custom_fields: [{ name: 'Cost', value: '125.5' }] } as any);
    expect(cost.cost).toBe(125.5);

    const estimation = extractor.extract({ id: '1', custom_fields: [{ name: 'Estimation', value: 8 }] } as any);
    expect(estimation.estimation).toBe(8);

    const estimateAlias = extractor.extract({ id: '1', custom_fields: [{ name: 'Time Estimate', value: 4 }] } as any);
    expect(estimateAlias.estimation).toBe(4);
  });

  describe('sprint name vs sprint points disambiguation', () => {
    it('reads a "Sprint" field into sprintName', () => {
      const result = extractor.extract({ id: '1', custom_fields: [{ name: 'Sprint', value: 'Sprint 12' }] } as any);
      expect(result.sprintName).toBe('Sprint 12');
    });

    it('does NOT read "Sprint Points" into sprintName (the !point guard)', () => {
      const result = extractor.extract({ id: '1', custom_fields: [{ name: 'Sprint Points', value: 5 }] } as any);
      expect(result.sprintName).toBeNull();
      expect(result.sprintPoints).toBe(5);
    });
  });

  describe('sprint points root-level fallback', () => {
    it('falls back to root-level points when no custom field is present', () => {
      expect(extractor.extract({ id: '1', points: 3 } as any).sprintPoints).toBe(3);
    });

    it('falls back to root-level story_points when points is absent', () => {
      expect(extractor.extract({ id: '1', story_points: 7 } as any).sprintPoints).toBe(7);
    });

    it('prefers points over story_points at root level', () => {
      expect(extractor.extract({ id: '1', points: 2, story_points: 9 } as any).sprintPoints).toBe(2);
    });

    it('lets a custom Sprint Points field override the root-level value', () => {
      const result = extractor.extract({ id: '1', points: 2, custom_fields: [{ name: 'Sprint Points', value: 5 }] } as any);
      expect(result.sprintPoints).toBe(5);
    });

    it('truncates fractional sprint points to an integer', () => {
      expect(extractor.extract({ id: '1', points: 3.9 } as any).sprintPoints).toBe(3);
    });

    it('clamps an out-of-int4-range value to 0 so it cannot overflow the column', () => {
      // A "number" custom field whose name contains "point" (e.g. a phone/id
      // field) got matched into sprint_points and blew up the upsert in prod.
      const fromCustomField = extractor.extract({ id: '1', custom_fields: [
        { name: 'Contact Point', value: 10001784894520 },
      ] } as any);
      expect(fromCustomField.sprintPoints).toBe(0);

      // Same guard on the root-level source.
      expect(extractor.extract({ id: '1', points: 10001784894520 } as any).sprintPoints).toBe(0);
      // Negative is nonsensical for points → 0.
      expect(extractor.extract({ id: '1', points: -5 } as any).sprintPoints).toBe(0);
      // A large-but-valid int4 value still passes through.
      expect(extractor.extract({ id: '1', points: 2000000000 } as any).sprintPoints).toBe(2000000000);
    });
  });

  describe('value guards', () => {
    it('skips custom fields whose value is null, undefined, or empty string', () => {
      const result = extractor.extract({ id: '1', custom_fields: [
        { name: 'Department', value: null },
        { name: 'Cost', value: '' },
        { name: 'Account Executive', value: undefined },
      ] } as any);
      expect(result.department).toBeNull();
      expect(result.cost).toBe(0);
      expect(result.executiveName).toBeNull();
    });

    it('returns all-default extraction for a task with no custom fields', () => {
      const result = extractor.extract({ id: '1' } as any);
      expect(result).toEqual({
        executiveName: null, department: null, client: null,
        cost: 0, estimation: 0, sprintName: null, sprintPoints: 0,
      });
    });
  });

  describe('client dropdown resolution', () => {
    it('returns null when the selected orderindex matches no option', () => {
      const result = extractor.extract({ id: '1', custom_fields: [
        { name: 'Client', type: 'drop_down', value: 9, type_config: { options: [{ orderindex: 1, name: 'Acme' }] } },
      ] } as any);
      expect(result.client).toBeNull();
    });

    it('returns null when type_config / options are missing', () => {
      const result = extractor.extract({ id: '1', custom_fields: [
        { name: 'Client', type: 'drop_down', value: 0 },
      ] } as any);
      expect(result.client).toBeNull();
    });

    it('does not resolve a "client" field that is not a drop_down', () => {
      const result = extractor.extract({ id: '1', custom_fields: [
        { name: 'Client', type: 'short_text', value: 'literal text' },
      ] } as any);
      expect(result.client).toBeNull();
    });
  });
});
