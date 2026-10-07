import { AttendanceRepository } from "./attendance.repository";

const leave = (over: Record<string, unknown> = {}) => ({
  employeeId: "e1",
  externalId: "x1",
  type: "CASUAL" as const,
  startDate: "2026-10-20",
  endDate: "2026-10-20",
  days: 1,
  status: "PENDING" as const,
  reason: "r",
  ...over,
});
const stored = (over: Record<string, unknown> = {}) => ({
  id: "L1",
  employeeId: "e1",
  externalId: "x1",
  type: "CASUAL",
  startDate: new Date("2026-10-20T00:00:00Z"),
  endDate: new Date("2026-10-20T00:00:00Z"),
  days: { toNumber: () => 1 },
  status: "PENDING",
  reason: "r",
  decidedAt: null,
  ...over,
});

function make(existing: unknown[]) {
  const prisma = {
    leaveRecord: {
      findMany: jest.fn().mockResolvedValue(existing),
      createMany: jest
        .fn()
        .mockImplementation(async ({ data }) => ({ count: data.length })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { repo: new AttendanceRepository(prisma as never), prisma };
}

describe("AttendanceRepository.upsertProviderLeaves", () => {
  it("creates unseen leave", async () => {
    const { repo, prisma } = make([]);
    expect(await repo.upsertProviderLeaves("dummy", [leave()])).toEqual({
      created: 1,
      updated: 0,
      preserved: 0,
    });
    expect(
      prisma.leaveRecord.createMany.mock.calls[0][0].data[0],
    ).toMatchObject({ source: "dummy", externalId: "x1", status: "PENDING" });
  });

  it("is idempotent: re-syncing an identical row writes nothing", async () => {
    const { repo, prisma } = make([stored()]);
    expect(await repo.upsertProviderLeaves("dummy", [leave()])).toEqual({
      created: 0,
      updated: 0,
      preserved: 0,
    });
    expect(prisma.leaveRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.leaveRecord.updateMany).not.toHaveBeenCalled();
  });

  it("a manual decision survives a re-sync that still says PENDING (and one that says APPROVED)", async () => {
    for (const decided of ["APPROVED", "REJECTED"]) {
      const { repo, prisma } = make([
        stored({ status: decided, decidedAt: new Date() }),
      ]);
      const res = await repo.upsertProviderLeaves("dummy", [
        leave({ status: "PENDING" }),
      ]);
      expect(res).toEqual({ created: 0, updated: 0, preserved: 1 });
      expect(prisma.leaveRecord.updateMany).not.toHaveBeenCalled();
    }
  });

  it("updates an undecided row the provider changed, guarded by decided_at IS NULL", async () => {
    const { repo, prisma } = make([stored()]);
    const res = await repo.upsertProviderLeaves("dummy", [
      leave({ status: "APPROVED" }),
    ]);
    expect(res.updated).toBe(1);
    expect(prisma.leaveRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "L1", decidedAt: null },
        data: expect.objectContaining({ status: "APPROVED" }),
      }),
    );
  });

  it("counts a row decided between the read and the write as preserved", async () => {
    const { repo, prisma } = make([stored()]);
    prisma.leaveRecord.updateMany.mockResolvedValue({ count: 0 });
    expect(
      (
        await repo.upsertProviderLeaves("dummy", [
          leave({ status: "APPROVED" }),
        ])
      ).preserved,
    ).toBe(1);
  });
});
