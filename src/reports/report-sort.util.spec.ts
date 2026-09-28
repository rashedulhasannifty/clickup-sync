import type { AccessScope } from "../access/access-scope";
import {
  parseSortDir,
  parseTaskGroupSort,
  sortTaskGroups,
  taskGroupSortNeedsTask,
  taskOrderBy,
  timeEntryOrderBy,
  type SortableTaskGroup,
  type TaskGroupSortAttrs,
} from "./report-sort.util";

const unrestricted: AccessScope = { kind: "unrestricted", canEdit: true };
// A LEAD of a team owning 'opt-a' — sees SOME cost, not all of it. The cost
// sorts must refuse this viewer too, not just a plain member: ranking by a
// column that is null on every row outside 'opt-a' is exactly the leak.
const scopedLead: AccessScope = {
  kind: "scoped",
  clients: new Map([["opt-a", "LEAD"]]),
  ledUserClickupIds: [],
  selfClickupId: null,
  ledTeamIds: ["t1"],
};

describe("parseSortDir", () => {
  it("is desc unless the caller literally asked for asc", () => {
    expect(parseSortDir("asc")).toBe("asc");
    expect(parseSortDir("desc")).toBe("desc");
    expect(parseSortDir("ASC")).toBe("desc");
    expect(parseSortDir(undefined)).toBe("desc");
    expect(parseSortDir("")).toBe("desc");
  });
});

describe("taskOrderBy", () => {
  it("keeps the page default for an absent or unrecognized key", () => {
    // This is the contract every non-UI caller relies on (exports, deep links).
    expect(taskOrderBy(undefined, "desc")).toEqual([{ updatedDate: "desc" }]);
    expect(taskOrderBy("bogus", "asc")).toEqual([{ updatedDate: "desc" }]);
    // Not a whitelisted key, even though it is a real column.
    expect(taskOrderBy("raw", "asc")).toEqual([{ updatedDate: "desc" }]);
  });

  it("orders by the requested column, in the requested direction", () => {
    expect(taskOrderBy("task_name", "asc")).toEqual([
      { taskName: "asc" },
      { taskId: "asc" },
    ]);
    expect(taskOrderBy("sprint_points", "desc")).toEqual([
      { sprintPoints: "desc" },
      { taskId: "asc" },
    ]);
  });

  it("puts nulls last on a nullable column, in BOTH directions", () => {
    expect(taskOrderBy("client", "desc")).toEqual([
      { client: { sort: "desc", nulls: "last" } },
      { taskId: "asc" },
    ]);
    expect(taskOrderBy("client", "asc")).toEqual([
      { client: { sort: "asc", nulls: "last" } },
      { taskId: "asc" },
    ]);
  });

  it("every whitelisted key carries the task_id tie-break", () => {
    const keys = [
      "task_name",
      "status",
      "space_name",
      "list_name",
      "client",
      "department",
      "sprint_name",
      "sprint_points",
      "time_estimate",
      "time_spent",
      "updated_date",
      "synced_at",
    ];
    for (const k of keys) {
      const out = taskOrderBy(k, "asc");
      // Without a unique last key, OFFSET paging can duplicate or skip rows.
      expect(out.at(-1)).toEqual({ taskId: "asc" });
      expect(out).toHaveLength(2);
    }
  });
});

describe("timeEntryOrderBy", () => {
  it("keeps the page default for an absent or unrecognized key", () => {
    expect(timeEntryOrderBy(undefined, "desc", unrestricted)).toEqual([
      { startTime: "desc" },
    ]);
    expect(timeEntryOrderBy("bogus", "asc", unrestricted)).toEqual([
      { startTime: "desc" },
    ]);
  });

  it("sorts task attributes through the relation", () => {
    expect(timeEntryOrderBy("taskName", "asc", unrestricted)).toEqual([
      { task: { taskName: "asc" } },
      { timeEntryId: "asc" },
    ]);
    expect(timeEntryOrderBy("listName", "desc", unrestricted)).toEqual([
      { task: { listName: { sort: "desc", nulls: "last" } } },
      { timeEntryId: "asc" },
    ]);
  });

  it("sorts an entry's own resolved chargeability", () => {
    expect(timeEntryOrderBy("chargeable", "desc", unrestricted)).toEqual([
      { isChargeable: "desc" },
      { timeEntryId: "asc" },
    ]);
  });

  describe("cost and rate are gated on seeing every row's cost", () => {
    it("an unrestricted viewer gets the cost sort they asked for", () => {
      expect(timeEntryOrderBy("costAud", "asc", unrestricted)).toEqual([
        { costCents: "asc" },
        { timeEntryId: "asc" },
      ]);
      expect(timeEntryOrderBy("hourlyRateCents", "desc", unrestricted)).toEqual(
        [{ hourlyRateCents: "desc" }, { timeEntryId: "asc" }],
      );
    });

    it("a scoped LEAD falls back to the default order, never a cost ranking", () => {
      // Position in a cost-sorted list IS a comparison; masked rows must not get one.
      expect(timeEntryOrderBy("costAud", "asc", scopedLead)).toEqual([
        { startTime: "desc" },
      ]);
      expect(timeEntryOrderBy("hourlyRateCents", "desc", scopedLead)).toEqual([
        { startTime: "desc" },
      ]);
    });

    it("a scoped viewer keeps every non-cost sort", () => {
      expect(timeEntryOrderBy("durationHours", "asc", scopedLead)).toEqual([
        { durationHours: "asc" },
        { timeEntryId: "asc" },
      ]);
    });
  });
});

describe("parseTaskGroupSort", () => {
  it("falls back to totalHours for an absent or unrecognized key", () => {
    expect(parseTaskGroupSort(undefined, unrestricted)).toBe("totalHours");
    expect(parseTaskGroupSort("bogus", unrestricted)).toBe("totalHours");
    // A flat-view key is not a grouped-view key.
    expect(parseTaskGroupSort("startTime", unrestricted)).toBe("totalHours");
  });

  it("accepts every grouped column key", () => {
    for (const k of [
      "taskName",
      "client",
      "listName",
      "entryCount",
      "totalHours",
      "chargeableHours",
      "chargeable",
      "missingRateCount",
      "lastActivity",
    ]) {
      expect(parseTaskGroupSort(k, scopedLead)).toBe(k);
    }
  });

  it("drops a cost sort for a scoped viewer, keeps it for an unrestricted one", () => {
    expect(parseTaskGroupSort("costAud", unrestricted)).toBe("costAud");
    expect(parseTaskGroupSort("costAud", scopedLead)).toBe("totalHours");
  });
});

describe("taskGroupSortNeedsTask", () => {
  it("is true only for the three keys that live on the task, not the bucket", () => {
    // This is what makes the service join every bucket's task BEFORE the slice.
    expect(taskGroupSortNeedsTask("taskName")).toBe(true);
    expect(taskGroupSortNeedsTask("client")).toBe(true);
    expect(taskGroupSortNeedsTask("listName")).toBe(true);
    expect(taskGroupSortNeedsTask("totalHours")).toBe(false);
    expect(taskGroupSortNeedsTask("costAud")).toBe(false);
  });
});

describe("sortTaskGroups", () => {
  const g = (
    taskId: string,
    over: Partial<SortableTaskGroup> = {},
  ): SortableTaskGroup => ({
    taskId,
    entryCount: 1,
    hours: 1,
    chargeableHours: 1,
    nonChargeableCount: 0,
    validCostCents: 100,
    missingRateCount: 0,
    lastActivity: null,
    ...over,
  });
  const noAttrs = new Map<string, TaskGroupSortAttrs>();

  it("orders by hours desc with a taskId tie-break by default", () => {
    const out = sortTaskGroups(
      [g("b", { hours: 2 }), g("a", { hours: 2 }), g("c", { hours: 9 })],
      "totalHours",
      "desc",
      noAttrs,
    );
    expect(out.map((b) => b.taskId)).toEqual(["c", "a", "b"]);
  });

  it("reverses on asc and keeps the same tie-break", () => {
    const out = sortTaskGroups(
      [g("b", { hours: 2 }), g("a", { hours: 2 }), g("c", { hours: 9 })],
      "totalHours",
      "asc",
      noAttrs,
    );
    expect(out.map((b) => b.taskId)).toEqual(["a", "b", "c"]);
  });

  it("ranks the tri-state charge pill: chargeable, then partial, then not", () => {
    const whole = g("whole", { entryCount: 4, nonChargeableCount: 0 });
    const partial = g("partial", { entryCount: 4, nonChargeableCount: 2 });
    const none = g("none", { entryCount: 4, nonChargeableCount: 4 });
    expect(
      sortTaskGroups([none, partial, whole], "chargeable", "asc", noAttrs).map(
        (b) => b.taskId,
      ),
    ).toEqual(["whole", "partial", "none"]);
  });

  it("a bucket of only 0-duration non-chargeable entries is NOT ranked as chargeable", () => {
    // Hours can't decide this: 0 chargeable hours === 0 total hours.
    const zeroHourNonChargeable = g("zero", {
      entryCount: 2,
      hours: 0,
      chargeableHours: 0,
      nonChargeableCount: 2,
    });
    const reallyChargeable = g("real", {
      entryCount: 2,
      hours: 0,
      chargeableHours: 0,
      nonChargeableCount: 0,
    });
    expect(
      sortTaskGroups(
        [zeroHourNonChargeable, reallyChargeable],
        "chargeable",
        "asc",
        noAttrs,
      ).map((b) => b.taskId),
    ).toEqual(["real", "zero"]);
  });

  it("sorts a task attribute case-insensitively from the joined map", () => {
    const attrs = new Map<string, TaskGroupSortAttrs>([
      ["1", { taskName: "beta", client: null, listName: null }],
      ["2", { taskName: "Alpha", client: null, listName: null }],
    ]);
    expect(
      sortTaskGroups([g("1"), g("2")], "taskName", "asc", attrs).map(
        (b) => b.taskId,
      ),
    ).toEqual(["2", "1"]);
  });

  it("puts a missing task attribute last in BOTH directions", () => {
    // `__none__` (entries with no task) and tasks whose row is gone must never
    // open a descending page — the SQL-side sorts put nulls last too.
    const attrs = new Map<string, TaskGroupSortAttrs>([
      ["a", { taskName: "Aaa", client: "Acme", listName: null }],
      ["b", { taskName: "Bbb", client: "Beta", listName: null }],
    ]);
    const rows = [g("a"), g("b"), g("__none__")];
    expect(
      sortTaskGroups(rows, "client", "asc", attrs).map((b) => b.taskId),
    ).toEqual(["a", "b", "__none__"]);
    expect(
      sortTaskGroups(rows, "client", "desc", attrs).map((b) => b.taskId),
    ).toEqual(["b", "a", "__none__"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [g("b", { hours: 1 }), g("a", { hours: 9 })];
    sortTaskGroups(rows, "totalHours", "desc", noAttrs);
    expect(rows.map((b) => b.taskId)).toEqual(["b", "a"]);
  });
});
