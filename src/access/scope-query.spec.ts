import { Prisma } from "@prisma/client";
import { resolveScope, ScopeInputs } from "./access-scope";
import {
  taskScopeWhere,
  timeEntryScopeWhere,
  taskScopeSql,
  leadScopeSql,
  taskIdInScopeSql,
} from "./scope-query";

const member = (clients: [string, "LEAD" | "MEMBER"][]) => {
  const i: ScopeInputs = {
    role: "MEMBER",
    scopingEnabled: true,
    selfClickupId: null,
    memberships: clients.map(([, r], n) => ({ teamId: `t${n}`, role: r })),
    teamClients: clients.map(([id], n) => ({ teamId: `t${n}`, optionId: id })),
    teamMembers: [],
  };
  return resolveScope(i);
};
const sqlText = (s: Prisma.Sql) => ({ text: s.sql, values: s.values });

describe("scope-query", () => {
  const all = resolveScope({
    role: "ADMIN",
    scopingEnabled: true,
    selfClickupId: null,
    memberships: [],
    teamClients: [],
    teamMembers: [],
  });

  it("unrestricted adds no constraint", () => {
    expect(taskScopeWhere(all)).toEqual({});
    expect(timeEntryScopeWhere(all)).toEqual({});
    expect(sqlText(taskScopeSql(all, "t")).text).toBe("TRUE");
  });

  it('EMPTY scope matches nothing — never "no filter"', () => {
    const none = member([]);
    expect(taskScopeWhere(none)).toEqual({ scopeClientOptionId: { in: [] } });
    expect(timeEntryScopeWhere(none)).toEqual({
      task: { scopeClientOptionId: { in: [] } },
    });
    expect(sqlText(taskScopeSql(none, "t")).text).toBe("FALSE");
    expect(sqlText(taskIdInScopeSql(none, "e.task_id")).text).toBe("FALSE");
  });

  it("scoped: filters on scope_client_option_id with bound values", () => {
    const s = member([
      ["acme", "LEAD"],
      ["bolt", "MEMBER"],
    ]);
    expect(taskScopeWhere(s)).toEqual({
      scopeClientOptionId: { in: ["acme", "bolt"] },
    });
    const sql = sqlText(taskScopeSql(s, "t"));
    expect(sql.text).toContain("t.scope_client_option_id = ANY(");
    expect(sql.values).toEqual([["acme", "bolt"]]);
    expect(sqlText(leadScopeSql(s, "t")).values).toEqual([["acme"]]);
  });

  it("member with no LEAD clients: lead fragment is FALSE", () => {
    expect(sqlText(leadScopeSql(member([["bolt", "MEMBER"]]), "t")).text).toBe(
      "FALSE",
    );
  });

  it("rejects an alias that is not a bare identifier (defence against injection)", () => {
    expect(() => taskScopeSql(member([["a", "LEAD"]]), "t; DROP")).toThrow();
  });
});
