import { replacementJobId } from './assignee-replacement.service';

describe('replacementJobId', () => {
  // Regression: the jobId used to be `replace:${id}`. BullMQ reserves ':' as its
  // Redis key separator and rejects custom job ids containing it with
  // "Custom Id cannot contain :", which crashed every time-entry sync whose
  // entries had replacement-trigger tags. The id must never contain a colon.
  it('never contains a colon', () => {
    for (const id of ['5125052390936872040', '86exxuxkm', '123', '']) {
      expect(replacementJobId(id)).not.toContain(':');
    }
  });

  it('is deterministic and unique per time entry', () => {
    expect(replacementJobId('abc')).toBe(replacementJobId('abc'));
    expect(replacementJobId('abc')).not.toBe(replacementJobId('def'));
  });
});
