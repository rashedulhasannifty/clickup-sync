import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { EmployeesService } from "./employees.service";

const admin = {
  userId: "u-admin",
  orgId: "org",
  role: "ADMIN",
  email: "a@x",
  isMachine: false,
} as never;
const machine = {
  userId: "machine",
  orgId: "org",
  role: "OWNER",
  email: null,
  isMachine: true,
} as never;

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  orgId: "org",
  fullName: "Ada",
  email: "ada@x.test",
  employeeCode: null,
  userId: null,
  clickupUserId: null,
  designation: "Engineer",
  grade: null,
  department: null,
  teamId: "t-old",
  managerId: null,
  joinDate: new Date("2025-01-01T00:00:00Z"),
  confirmationDate: null,
  exitDate: null,
  status: "PROBATION",
  team: { name: "Old" },
  manager: null,
  ...over,
});

function make(over: Record<string, jest.Mock> = {}) {
  const repo = {
    findById: jest.fn().mockResolvedValue(row()),
    findTeamInOrg: jest.fn().mockResolvedValue({ id: "t1", name: "New" }),
    existsInOrg: jest.fn().mockResolvedValue(true),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (d) =>
      row({
        ...d,
        team: null,
        joinDate: new Date(`${d.joinDate}T00:00:00Z`),
      }),
    ),
    update: jest.fn().mockImplementation(async (_id, d) => row(d)),
    addEvent: jest.fn().mockImplementation(async (a) => ({
      id: 7n,
      type: a.type,
      effectiveDate: new Date(`${a.effectiveDate}T00:00:00Z`),
      fromValue: a.fromValue,
      toValue: a.toValue,
      notes: a.notes,
      createdBy: a.createdBy,
      createdAt: new Date("2026-10-07T00:00:00Z"),
    })),
    listEvents: jest.fn().mockResolvedValue([]),
    teamNames: jest.fn().mockResolvedValue([]),
    userNames: jest.fn().mockResolvedValue([]),
    usersWithoutEmployee: jest.fn().mockResolvedValue([]),
    emailsTaken: jest.fn().mockResolvedValue([]),
    clickupIdsTaken: jest.fn().mockResolvedValue([]),
    unlinkedEmployees: jest.fn().mockResolvedValue([]),
    linkIdentity: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { svc: new EmployeesService(repo as never), repo };
}

describe("EmployeesService.addEvent side-effects", () => {
  const ev = (type: string, extra: Record<string, unknown> = {}) =>
    ({ type, effectiveDate: "2026-04-01", ...extra }) as never;

  it("PROMOTED applies the new designation and defaults fromValue to the current one", async () => {
    const { svc, repo } = make();
    await svc.addEvent(
      admin,
      "e1",
      ev("PROMOTED", { toValue: "Senior Engineer" }),
    );
    expect(repo.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        fromValue: "Engineer",
        toValue: "Senior Engineer",
        patch: { designation: "Senior Engineer" },
        createdBy: "u-admin",
      }),
    );
  });

  it("CONFIRMED -> confirmation date + ACTIVE; NOTICE_GIVEN -> NOTICE; EXITED -> exit date + EXITED", async () => {
    const { svc, repo } = make();
    await svc.addEvent(admin, "e1", ev("CONFIRMED"));
    expect(repo.addEvent.mock.calls[0][0].patch).toEqual({
      confirmationDate: "2026-04-01",
      status: "ACTIVE",
    });
    await svc.addEvent(admin, "e1", ev("NOTICE_GIVEN"));
    expect(repo.addEvent.mock.calls[1][0].patch).toEqual({ status: "NOTICE" });
    await svc.addEvent(admin, "e1", ev("EXITED"));
    expect(repo.addEvent.mock.calls[2][0].patch).toEqual({
      exitDate: "2026-04-01",
      status: "EXITED",
    });
  });

  it("TRANSFERRED moves the team when it resolves in the org, and still records the event when it does not", async () => {
    const { svc, repo } = make();
    await svc.addEvent(admin, "e1", ev("TRANSFERRED", { toValue: "t1" }));
    expect(repo.findTeamInOrg).toHaveBeenCalledWith("org", "t1");
    expect(repo.addEvent.mock.calls[0][0]).toMatchObject({
      fromValue: "t-old",
      patch: { teamId: "t1" },
    });

    const miss = make({ findTeamInOrg: jest.fn().mockResolvedValue(null) });
    await miss.svc.addEvent(
      admin,
      "e1",
      ev("TRANSFERRED", { toValue: "nope" }),
    );
    expect(miss.repo.addEvent.mock.calls[0][0].patch).toEqual({});
  });

  it("a NOTE changes nothing; an event that needs a toValue without one is a 400", async () => {
    const { svc, repo } = make();
    await svc.addEvent(admin, "e1", ev("NOTE", { notes: "hi" }));
    expect(repo.addEvent.mock.calls[0][0].patch).toEqual({});
    await expect(
      svc.addEvent(admin, "e1", ev("PROMOTED")),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.addEvent(admin, "e1", ev("TRANSFERRED")),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s an employee outside the org and never stores the machine principal as the actor", async () => {
    const { svc, repo } = make({ findById: jest.fn().mockResolvedValue(null) });
    await expect(svc.addEvent(admin, "x", ev("NOTE"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const m = make();
    await m.svc.addEvent(machine, "e1", ev("NOTE"));
    expect(m.repo.addEvent.mock.calls[0][0].createdBy).toBeNull();
    expect(repo.addEvent).not.toHaveBeenCalled();
  });

  it("labels TRANSFERRED events with team names and returns plain strings/numbers", async () => {
    const { svc } = make({
      teamNames: jest.fn().mockResolvedValue([{ id: "t1", name: "Platform" }]),
    });
    const v = await svc.addEvent(
      admin,
      "e1",
      ev("TRANSFERRED", { toValue: "t1" }),
    );
    expect(v).toMatchObject({
      id: "7",
      toLabel: "Platform",
      effectiveDate: "2026-04-01",
      createdAt: "2026-10-07T00:00:00.000Z",
    });
  });
});

describe("EmployeesService.create / update", () => {
  const dto = {
    fullName: " Ada ",
    email: "Ada@X.test",
    designation: "Engineer",
    joinDate: "2026-01-15",
  } as never;

  it("lower-cases the email, links a free login of the same email, and inherits its ClickUp id", async () => {
    const { svc, repo } = make({
      findUserByEmail: jest
        .fn()
        .mockResolvedValue({ id: "u1", clickupUserId: "999", employee: null }),
    });
    await svc.create(admin, dto);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@x.test",
        fullName: "Ada",
        userId: "u1",
        clickupUserId: "999",
      }),
    );
  });

  it("does not steal a login that already has an employee", async () => {
    const { svc, repo } = make({
      findUserByEmail: jest.fn().mockResolvedValue({
        id: "u1",
        clickupUserId: null,
        employee: { id: "other" },
      }),
    });
    await svc.create(admin, dto);
    expect(repo.create.mock.calls[0][0].userId).toBeNull();
  });

  it("maps a unique violation to a 409", async () => {
    const { svc } = make({
      create: jest
        .fn()
        .mockRejectedValue({ code: "P2002", meta: { target: ["email"] } }),
    });
    await expect(svc.create(admin, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("refuses a manager outside the org, and being your own manager", async () => {
    const { svc } = make({ existsInOrg: jest.fn().mockResolvedValue(false) });
    await expect(
      svc.update("org", "e1", { managerId: "m" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    const self = make();
    await expect(
      self.svc.update("org", "e1", { managerId: "e1" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("null clears a nullable field; omitted leaves it alone", async () => {
    const { svc, repo } = make();
    await svc.update("org", "e1", { grade: null, teamId: null } as never);
    expect(repo.update).toHaveBeenCalledWith("e1", {
      grade: null,
      teamId: null,
    });
  });
});

describe("EmployeesService.importFromUsers", () => {
  it("creates an Unassigned ACTIVE employee per free login, skipping emails already taken", async () => {
    const { svc, repo } = make({
      usersWithoutEmployee: jest.fn().mockResolvedValue([
        {
          id: "u1",
          email: "New@x.test",
          name: null,
          clickupUserId: "5",
          createdAt: new Date("2026-03-01T10:00:00Z"),
        },
        {
          id: "u2",
          email: "dup@x.test",
          name: "Dup",
          clickupUserId: null,
          createdAt: new Date("2026-03-01T10:00:00Z"),
        },
      ]),
      emailsTaken: jest
        .fn()
        .mockResolvedValue([{ email: "dup@x.test", clickupUserId: null }]),
      unlinkedEmployees: jest
        .fn()
        .mockResolvedValue([
          { id: "eDup", email: "dup@x.test", clickupUserId: null },
        ]),
    });
    const res = await svc.importFromUsers(admin);
    expect(res).toEqual({ created: 1, linked: 1 });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@x.test",
        fullName: "new",
        designation: "Unassigned",
        userId: "u1",
        joinDate: "2026-03-01",
        status: "ACTIVE",
      }),
    );
    expect(repo.linkIdentity).toHaveBeenCalledWith("eDup", { userId: "u2" });
  });
});
