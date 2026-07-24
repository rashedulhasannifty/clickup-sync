import { csvList } from '../src/reports/report-filter.util';

describe('csvList', () => {
  it('returns undefined for undefined', () => {
    expect(csvList(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(csvList('')).toBeUndefined();
  });

  it('returns undefined for a comma-only string', () => {
    expect(csvList(' , , ')).toBeUndefined();
  });

  it('wraps a single value in a one-element list (the deep-link path)', () => {
    expect(csvList('Acme Corp')).toEqual(['Acme Corp']);
  });

  it('splits multiple values', () => {
    expect(csvList('Acme,Beta,Contoso')).toEqual(['Acme', 'Beta', 'Contoso']);
  });

  it('trims surrounding whitespace on each value', () => {
    expect(csvList(' Acme , Beta ')).toEqual(['Acme', 'Beta']);
  });

  it('drops empty parts between commas', () => {
    expect(csvList('Acme,,Beta, ,Contoso')).toEqual(['Acme', 'Beta', 'Contoso']);
  });

  it('de-duplicates while preserving first-seen order', () => {
    expect(csvList('Beta,Acme,Beta')).toEqual(['Beta', 'Acme']);
  });
});
