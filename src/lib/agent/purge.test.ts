/**
 * purge 单测(prisma/checkpointer 必 mock):30 天 cutoff、按批循环清空、
 * checkpoint 删失败不反噬、空批即止。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  searchAgentSession: {
    findMany: vi.fn(),
    delete: vi.fn(),
  },
}));
const deleteThreadMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("./checkpointer", () => ({ deleteThread: deleteThreadMock }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { purgeAgentSessions } from "./purge";

beforeEach(() => {
  prismaMock.searchAgentSession.findMany.mockReset();
  prismaMock.searchAgentSession.delete.mockReset();
  deleteThreadMock.mockReset();
  deleteThreadMock.mockResolvedValue(undefined);
});

describe("purgeAgentSessions", () => {
  it("删 cutoff 之前的行,行+checkpoint 同删,返回行数", async () => {
    prismaMock.searchAgentSession.findMany.mockResolvedValue([{ id: "t-1" }, { id: "t-2" }]);
    await expect(purgeAgentSessions(new Date("2026-10-07T04:33:00+08:00"))).resolves.toBe(2);
    // 30 天前 = 2026-09-06T20:33Z(UTC 换算)
    expect(prismaMock.searchAgentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lastMessageAt: { lt: new Date("2026-09-06T20:33:00.000Z") } },
        take: 200,
      }),
    );
    expect(prismaMock.searchAgentSession.delete).toHaveBeenCalledTimes(2);
    expect(deleteThreadMock).toHaveBeenCalledWith("t-1");
    expect(deleteThreadMock).toHaveBeenCalledWith("t-2");
  });

  it("checkpoint 删失败:行仍删、计数含该行、只告警", async () => {
    prismaMock.searchAgentSession.findMany.mockResolvedValue([{ id: "t-1" }]);
    deleteThreadMock.mockRejectedValue(new Error("cp down"));
    await expect(purgeAgentSessions()).resolves.toBe(1);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it("满批续扫,不足批即止", async () => {
    // 第一轮满批 200 续扫,第二轮 3 条(< PURGE_BATCH)终止
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `t-${i}` }));
    prismaMock.searchAgentSession.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ id: "x-1" }, { id: "x-2" }, { id: "x-3" }]);
    await expect(purgeAgentSessions()).resolves.toBe(203);
    expect(prismaMock.searchAgentSession.findMany).toHaveBeenCalledTimes(2);
  });

  it("首轮即空 → 0 且不触删", async () => {
    prismaMock.searchAgentSession.findMany.mockResolvedValue([]);
    await expect(purgeAgentSessions()).resolves.toBe(0);
    expect(prismaMock.searchAgentSession.delete).not.toHaveBeenCalled();
  });
});
