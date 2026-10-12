import {
  clockDistance,
  median,
  suggestShifts,
  type SuggestShift,
} from './shift-suggestions';

const shifts: SuggestShift[] = [
  { id: 'm', name: 'Morning', startMinutes: 9 * 60 + 30, trackPunctuality: true },
  { id: 'd', name: 'Day', startMinutes: 11 * 60 + 30, trackPunctuality: true },
  { id: 'e', name: 'Evening', startMinutes: 14 * 60, trackPunctuality: true },
];
const times = (...hm: number[]) => hm.map((h) => Math.round(h * 60));

describe('suggestShifts', () => {
  it('proposes the shift whose start is nearest the median first-in', () => {
    const [s] = suggestShifts(
      [{ id: '1', fullName: 'Test A', shiftId: null, firstIns: times(11, 11.2, 12.5, 10.9, 11.4) }],
      shifts,
    );
    expect(s).toMatchObject({
      proposedShiftId: 'd',
      medianFirstIn: 11 * 60 + 12,
      sampleDays: 5,
      distanceMinutes: 18,
      changes: true,
      irregular: false,
    });
  });

  it('marks no change when the employee already has the proposed shift', () => {
    const [s] = suggestShifts(
      [{ id: '1', fullName: 'Test B', shiftId: 'e', firstIns: times(14, 14.1, 13.9, 14.2, 14) }],
      shifts,
    );
    expect(s.changes).toBe(false);
  });

  it('skips employees with too few real days, and returns nothing without shifts', () => {
    const emp = { id: '1', fullName: 'Test C', shiftId: null, firstIns: times(9, 9.5) };
    expect(suggestShifts([emp], shifts)).toEqual([]);
    expect(suggestShifts([{ ...emp, firstIns: times(9, 9, 9, 9, 9) }], [])).toEqual([]);
  });

  it('irregular arrivals prefer a shift that does not track punctuality', () => {
    const flexible = { id: 'f', name: 'Flexible', startMinutes: 15 * 60, trackPunctuality: false };
    const [s] = suggestShifts(
      [{ id: '1', fullName: 'Test D', shiftId: null, firstIns: times(2, 8, 13, 19, 23, 5) }],
      [...shifts, flexible],
    );
    expect(s.irregular).toBe(true);
    expect(s.proposedShiftId).toBe('f');
  });

  it('never puts a regular arriver on an untracked shift, even when its start is nearer', () => {
    const withFlex = [
      ...shifts,
      { id: 'f', name: 'Flexible', startMinutes: 9 * 60, trackPunctuality: false },
    ];
    const [s] = suggestShifts(
      [{ id: '1', fullName: 'Test E', shiftId: null, firstIns: times(9.1, 9.15, 9.2, 9.1, 9.25) }],
      withFlex,
    );
    expect(s).toMatchObject({ proposedShiftId: 'm', irregular: false });
  });

  it('measures distance around the clock', () => {
    expect(clockDistance(23 * 60 + 50, 10)).toBe(20);
    expect(clockDistance(600, 660)).toBe(60);
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});
