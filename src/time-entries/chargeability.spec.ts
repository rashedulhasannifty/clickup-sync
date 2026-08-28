import { resolveChargeability, ruleKey } from './chargeability';

describe('resolveChargeability', () => {
  it('falls back to chargeable when nothing is set', () => {
    expect(resolveChargeability({})).toEqual({ chargeable: true, source: 'default' });
  });

  it('uses the task flag when there is no rule and no override', () => {
    expect(resolveChargeability({ taskChargeable: false })).toEqual({ chargeable: false, source: 'task' });
  });

  it('lets a rule override the task flag', () => {
    expect(resolveChargeability({ rule: false, taskChargeable: true })).toEqual({ chargeable: false, source: 'assignee' });
  });

  // The case that motivates "most specific wins in EITHER direction": one
  // person's time is billable on an otherwise internal task.
  it('lets a rule make time chargeable on a non-chargeable task', () => {
    expect(resolveChargeability({ rule: true, taskChargeable: false })).toEqual({ chargeable: true, source: 'assignee' });
  });

  it('lets an entry override beat its own rule', () => {
    expect(resolveChargeability({ entryOverride: true, rule: false, taskChargeable: false }))
      .toEqual({ chargeable: true, source: 'entry' });
    expect(resolveChargeability({ entryOverride: false, rule: true, taskChargeable: true }))
      .toEqual({ chargeable: false, source: 'entry' });
  });

  // null and undefined both mean "this layer says nothing" — null is what an
  // unset `chargeable_override` column reads as, undefined is what a missing
  // Map lookup returns. Neither may be coerced to false.
  it.each([null, undefined])('treats %p as "layer says nothing", not as false', (empty) => {
    expect(resolveChargeability({ entryOverride: empty, rule: empty, taskChargeable: true }))
      .toEqual({ chargeable: true, source: 'task' });
  });

  it('does not let a null task flag mask a rule', () => {
    expect(resolveChargeability({ rule: false, taskChargeable: null }))
      .toEqual({ chargeable: false, source: 'assignee' });
  });
});

describe('ruleKey', () => {
  it('joins task and user with a separator that cannot appear in a ClickUp id', () => {
    expect(ruleKey('86abc123', 'u1')).toBe('86abc123|u1');
  });
});
