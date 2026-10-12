import {
  buildAttendanceStrip,
  classifyDay,
  classifyToday,
  isInOffice,
} from "./attendance-math";
import { computeKpis, overallOf } from "./kpi-math";
import { dhakaInstant } from "./people-dates";
import {
  DEFAULT_PUNCTUALITY,
  formatMinutes,
  isOnTimeFor,
  punctualityOf,
  shiftLengthMinutes,
} from "./shift-math";

/** Mon 2026-10-05. */
const MON = "2026-10-05";
const SAT = "2026-10-10";
const day = (shift: Parameters<typeof punctualityOf>[0]) =>
  punctualityOf(shift);
const evening = {
  startMinutes: 14 * 60,
  endMinutes: 23 * 60,
  graceMinutes: 15,
  trackPunctuality: true,
};
const irregular = { ...evening, trackPunctuality: false };

describe("shift rule", () => {
  it("no shift is exactly the old 09:30 rule and an 8-hour day", () => {
    expect(punctualityOf(null)).toEqual(DEFAULT_PUNCTUALITY);
    expect(DEFAULT_PUNCTUALITY).toEqual({
      tracked: true,
      lateAfterMinutes: 9 * 60 + 30,
      dayHours: 8,
    });
    expect(
      isOnTimeFor(dhakaInstant(MON, 9 * 60 + 30), DEFAULT_PUNCTUALITY),
    ).toBe(true);
    expect(
      isOnTimeFor(
        new Date(dhakaInstant(MON, 9 * 60 + 30).getTime() + 1000),
        DEFAULT_PUNCTUALITY,
      ),
    ).toBe(false);
  });

  it("late = after start + grace; start + grace exactly is on time, one second later is late", () => {
    const p = day(evening);
    expect(p.lateAfterMinutes).toBe(14 * 60 + 15);
    const edge = dhakaInstant(MON, 14 * 60 + 15);
    expect(isOnTimeFor(edge, p)).toBe(true);
    expect(isOnTimeFor(new Date(edge.getTime() + 1000), p)).toBe(false);
    // Early is on time; the morning default would have called 14:00 late.
    expect(isOnTimeFor(dhakaInstant(MON, 13 * 60), p)).toBe(true);
  });

  it("expected hours come from the shift length, across midnight too", () => {
    expect(day(evening).dayHours).toBe(9);
    expect(shiftLengthMinutes(22 * 60, 6 * 60)).toBe(8 * 60);
    expect(shiftLengthMinutes(600, 600)).toBe(1440);
    expect(formatMinutes(14 * 60 + 5)).toBe("14:05");
  });
});

describe("shift-aware classification", () => {
  const row = (minutes: number, extra = {}) => ({
    date: MON,
    firstIn: dhakaInstant(MON, minutes),
    lastOut: null,
    minutesInOffice: null,
    ...extra,
  });

  it("an evening arrival at 14:10 is late by default but on time on the evening shift", () => {
    const args = { date: MON, today: MON, row: row(14 * 60 + 10), leaves: [] };
    expect(classifyDay(args)).toBe("late");
    expect(classifyDay({ ...args, punctuality: day(evening) })).toBe("on-time");
    expect(classifyDay({ ...args, punctuality: day(irregular) })).toBe(
      "present",
    );
  });

  it("today follows the shift, and a weekend punch is weekend work, never late", () => {
    const employment = { joinDate: "2026-01-01", exitDate: null };
    expect(
      classifyToday({
        today: MON,
        employment,
        row: row(14 * 60 + 20),
        leaves: [],
        punctuality: day(evening),
      }),
    ).toBe("late");
    expect(
      classifyToday({
        today: MON,
        employment,
        row: row(16 * 60),
        leaves: [],
        punctuality: day(irregular),
      }),
    ).toBe("present");
    expect(
      classifyToday({
        today: SAT,
        employment,
        row: {
          ...row(16 * 60),
          date: SAT,
          firstIn: dhakaInstant(SAT, 16 * 60),
        },
        leaves: [],
      }),
    ).toBe("weekend");
    expect(
      classifyToday({ today: SAT, employment, row: undefined, leaves: [] }),
    ).toBe("non-working");
  });

  it("in office while the last session has no out, even with an earlier out", () => {
    expect(
      isInOffice(
        row(600, { lastOut: dhakaInstant(MON, 700), missingOut: true }),
      ),
    ).toBe(true);
    expect(
      isInOffice(
        row(600, { lastOut: dhakaInstant(MON, 700), missingOut: false }),
      ),
    ).toBe(false);
    expect(isInOffice(row(600))).toBe(true);
    expect(isInOffice(undefined)).toBe(false);
  });

  it("the strip lists weekend days only when someone punched in, without shortening the business days", () => {
    const strip = buildAttendanceStrip({
      today: "2026-10-12",
      employment: { joinDate: "2026-01-01", exitDate: null },
      rows: [
        {
          date: SAT,
          firstIn: dhakaInstant(SAT, 600),
          lastOut: dhakaInstant(SAT, 720),
          minutesInOffice: 120,
          sessions: 1,
          workedMinutes: 120,
          missingOut: false,
          note: "x",
          source: "STELLAR_CSV",
        },
      ],
      leaves: [],
      limit: 5,
    });
    expect(strip.map((d) => [d.date, d.state])).toEqual([
      ["2026-10-06", "absent"],
      ["2026-10-07", "absent"],
      ["2026-10-08", "absent"],
      ["2026-10-09", "absent"],
      [SAT, "weekend"],
      ["2026-10-12", "future"],
    ]);
    expect(strip[4]).toMatchObject({
      sessions: 1,
      workedMinutes: 120,
      note: "x",
      source: "stellar-csv",
    });
    expect(strip[0]).toMatchObject({
      sessions: null,
      source: null,
      missingOut: false,
    });
  });

  it("an approved leave on a day with no punches shows the leave, not absent", () => {
    const noPunch = {
      date: MON,
      firstIn: null,
      lastOut: null,
      minutesInOffice: null,
      sessions: 0,
      source: "STELLAR_CSV" as const,
    };
    const args = { date: MON, today: "2026-10-12", row: noPunch };
    expect(classifyDay({ ...args, leaves: [] })).toBe("absent");
    expect(
      classifyDay({
        ...args,
        leaves: [{ type: "SICK", startDate: MON, endDate: MON, days: 1 }],
      }),
    ).toBe("sick");
  });
});

describe("shift-aware KPIs", () => {
  const base = {
    period: { from: MON, to: "2026-10-09" },
    employment: { joinDate: "2026-01-01", exitDate: null },
    clickupLinked: true,
    hours: [{ date: MON, hours: 9, chargeableHours: 9 }],
    deliveries: [],
    approvedLeave: [],
    attendance: [
      { date: MON, firstIn: dhakaInstant(MON, 14 * 60 + 10) },
      { date: "2026-10-06", firstIn: dhakaInstant("2026-10-06", 14 * 60 + 30) },
      // Weekend work: never counted for punctuality.
      { date: SAT, firstIn: dhakaInstant(SAT, 20 * 60) },
    ],
  };

  it("punctuality is against the shift and ignores weekend punches", () => {
    expect(computeKpis(base).kpis.punctuality).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
    expect(
      computeKpis({ ...base, punctuality: day(evening) }).kpis.punctuality,
    ).toMatchObject({ numerator: 1, denominator: 2, value: 50 });
  });

  it("a shift that does not track punctuality drops the KPI and marks the score partial", () => {
    const c = computeKpis({ ...base, punctuality: day(irregular) });
    expect(c.kpis.punctuality).toMatchObject({
      value: null,
      reason: "not-tracked",
      numerator: 0,
      denominator: 0,
    });
    expect(c.overall.partial).toBe(true);
    expect(c.overall.basedOn).not.toContain("punctuality");
    expect(overallOf(computeKpis(base).kpis).partial).toBe(false);
  });

  it("expected hours use the shift length; no shift keeps 8", () => {
    expect(computeKpis(base).hours.available).toBe(40);
    expect(
      computeKpis({ ...base, punctuality: day(evening) }).hours.available,
    ).toBe(45);
  });
});
