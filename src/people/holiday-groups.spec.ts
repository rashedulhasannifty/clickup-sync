import { groupHolidays } from './holiday-groups';

const row = (date: string, name: string, tentative = false) => ({
  id: date,
  date,
  name,
  tentative,
});

describe('groupHolidays', () => {
  it('joins consecutive same-name dates and counts only Mon-Fri as days off', () => {
    // Mon 25 .. Sun 31 May 2026: seven days, five of them Mon-Fri.
    const eid = ['25', '26', '27', '28', '29', '30', '31'].map((d) =>
      row(`2026-05-${d}`, 'Eid-ul-Adha'),
    );
    const [g] = groupHolidays([...eid].reverse());
    expect(g).toMatchObject({
      name: 'Eid-ul-Adha',
      from: '2026-05-25',
      to: '2026-05-31',
      days: 7,
      workingDaysOff: 5,
      tentative: false,
    });
    expect(g.ids).toHaveLength(7);
  });

  it('keeps different names and gaps apart, and a tentative date marks the group', () => {
    const groups = groupHolidays([
      row('2026-03-17', 'Shab-e-Qadr'),
      row('2026-03-18', 'Eid-ul-Fitr'),
      row('2026-03-19', 'Eid-ul-Fitr', true),
      row('2026-03-26', 'Independence Day'),
      row('2026-03-28', 'Independence Day'),
    ]);
    expect(groups.map((g) => [g.name, g.from, g.to, g.tentative])).toEqual([
      ['Shab-e-Qadr', '2026-03-17', '2026-03-17', false],
      ['Eid-ul-Fitr', '2026-03-18', '2026-03-19', true],
      ['Independence Day', '2026-03-26', '2026-03-26', false],
      ['Independence Day', '2026-03-28', '2026-03-28', false],
    ]);
    // Sat 28 March: a holiday on a weekend takes no working day.
    expect(groups[3].workingDaysOff).toBe(0);
  });
});
