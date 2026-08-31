import { isPartiallyChargeable, resolveChargeability, ruleKey } from './chargeability';

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

describe('isPartiallyChargeable', () => {
  // The task pill is tri-state: a task is "partial" when its own flag does not
  // describe every hour on it. Two independent signals can make that true.

  describe('rules that disagree with the task flag', () => {
    it('is partial when a rule excludes one assignee from a chargeable task', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [false] })).toBe(true);
    });

    it('is partial when a rule includes one assignee on a non-chargeable task', () => {
      expect(isPartiallyChargeable({ taskChargeable: false, rules: [true] })).toBe(true);
    });

    // The spec's literal wording was "at least one rule". That mislabels the
    // revert-via-rule path: set someone non-chargeable, change your mind, set
    // the rule back to chargeable rather than clearing it. Nothing is split,
    // so nothing should read as partial.
    it('is NOT partial when every rule agrees with the task flag', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [true, true] })).toBe(false);
      expect(isPartiallyChargeable({ taskChargeable: false, rules: [false] })).toBe(false);
    });

    it('is partial when rules disagree with each other', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [true, false] })).toBe(true);
    });

    // The prospective case that justified standing rules at all: the rule is
    // set before anyone logs time, so there are no entries to disagree yet.
    it('sees a rule with no entries at all', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [false], entryCount: 0, nonChargeableCount: 0 }))
        .toBe(true);
    });

    it('is NOT partial with no rules and no entries', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [] })).toBe(false);
    });
  });

  describe('entries that disagree with each other', () => {
    it('is partial when some entries are non-chargeable and some are not', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [], entryCount: 3, nonChargeableCount: 1 }))
        .toBe(true);
    });

    it('is NOT partial when every entry is non-chargeable', () => {
      expect(isPartiallyChargeable({ taskChargeable: false, rules: [], entryCount: 3, nonChargeableCount: 3 }))
        .toBe(false);
    });

    it('is NOT partial when no entry is non-chargeable', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [], entryCount: 3, nonChargeableCount: 0 }))
        .toBe(false);
    });

    // Guards the subtlety already called out in the grouped-by-task view: the
    // split is decided by entry COUNTS, never by an hours sum, so a bucket of
    // 0-duration non-chargeable entries still reads as partial.
    it('decides on counts, so 0-duration entries still split a task', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [], entryCount: 2, nonChargeableCount: 1 }))
        .toBe(true);
    });

    // The window-scoped caller (grouped-by-task rows) passes no rules at all;
    // the unscoped caller (Tasks page) passes rules. Both go through here so
    // the mixed-entries condition has exactly one definition.
    it('omitted entry counts mean "this caller has no entry signal"', () => {
      expect(isPartiallyChargeable({ taskChargeable: true, rules: [] })).toBe(false);
    });
  });
});

describe('isPartiallyChargeable — omitted task flag', () => {
  // The window-scoped caller passes no rules, so it has no flag to compare
  // against and omits it. The entry signal must still work on its own.
  it('still splits on mixed entries with no task flag given', () => {
    expect(isPartiallyChargeable({ rules: [], entryCount: 4, nonChargeableCount: 2 })).toBe(true);
  });

  // Guards against `r !== undefined` silently making every rule "disagree".
  it('never reports partial from rules alone when the flag is omitted', () => {
    expect(isPartiallyChargeable({ rules: [true, false] })).toBe(false);
  });
});

describe('isPartiallyChargeable — every entry disagrees with the flag', () => {
  // The hole overrides opened: not "mixed", and no rule disagrees, so the
  // first two arms both miss. The task read as wholly chargeable while its
  // every hour was non-chargeable — and, worse, satisfied none of the three
  // filter buckets, so it was reachable by no filter at all.
  it('is partial when a chargeable task has every entry overridden away', () => {
    expect(isPartiallyChargeable({ taskChargeable: true, rules: [], entryCount: 3, nonChargeableCount: 3 }))
      .toBe(true);
  });

  it('is partial when a non-chargeable task has every entry overridden back', () => {
    expect(isPartiallyChargeable({ taskChargeable: false, rules: [], entryCount: 3, nonChargeableCount: 0 }))
      .toBe(true);
  });

  it('is NOT partial when the entries agree with the flag', () => {
    expect(isPartiallyChargeable({ taskChargeable: true, rules: [], entryCount: 3, nonChargeableCount: 0 }))
      .toBe(false);
    expect(isPartiallyChargeable({ taskChargeable: false, rules: [], entryCount: 3, nonChargeableCount: 3 }))
      .toBe(false);
  });

  // A task with no time on it agrees with its flag vacuously. Without the
  // entryCount guard, `nonChargeableCount === entryCount` is 0 === 0 and every
  // empty chargeable task would read as partial.
  it('is NOT partial for a task with no entries at all', () => {
    expect(isPartiallyChargeable({ taskChargeable: true, rules: [], entryCount: 0, nonChargeableCount: 0 }))
      .toBe(false);
    expect(isPartiallyChargeable({ taskChargeable: false, rules: [], entryCount: 0, nonChargeableCount: 0 }))
      .toBe(false);
  });

  // The window-scoped caller passes no flag, so this arm must stay off for it:
  // "every entry in this window is non-chargeable" is a wholly non-chargeable
  // row, not a partial one.
  it('stays off when no task flag is given', () => {
    expect(isPartiallyChargeable({ rules: [], entryCount: 3, nonChargeableCount: 3 })).toBe(false);
    expect(isPartiallyChargeable({ rules: [], entryCount: 3, nonChargeableCount: 0 })).toBe(false);
  });
});
