import { toStringOrNull, toStringOrEmpty, toNumberOrZero, joinNames } from '../src/common/utils/safe-value';

describe('toStringOrNull', () => {
  it.each([
    [null, null], [undefined, null], ['', null], [0, '0'], ['x', 'x'], [5, '5'],
  ])('%p -> %p', (input, out) => {
    expect(toStringOrNull(input)).toBe(out);
  });
});

describe('toStringOrEmpty', () => {
  it.each([
    [null, ''], [undefined, ''], ['', ''], [0, '0'], ['x', 'x'],
  ])('%p -> %p', (input, out) => {
    expect(toStringOrEmpty(input)).toBe(out);
  });
});

describe('toNumberOrZero', () => {
  it.each([
    ['5', 5], [5, 5], ['', 0], [null, 0], ['abc', 0], [NaN, 0], [Infinity, 0], [-3, -3],
  ])('%p -> %p', (input, out) => {
    expect(toNumberOrZero(input as any)).toBe(out);
  });
});

describe('joinNames', () => {
  it('joins truthy values of the default `username` key', () => {
    expect(joinNames([{ username: 'a' }, { username: 'b' }])).toBe('a,b');
  });
  it('filters falsy entries and returns null when nothing remains', () => {
    expect(joinNames([{ username: '' }, { username: null }, {}])).toBeNull();
  });
  it('supports a custom key', () => {
    expect(joinNames([{ email: 'x@y' }, { email: '' }], 'email')).toBe('x@y');
  });
});
