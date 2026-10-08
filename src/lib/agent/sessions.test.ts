/**
 * sessions 单测(prisma 必 mock):标题派生(首行 20 码点/空回落)、
 * 删除归属校验(checkpoint 删失败不反噬)、touch tokens 累计、标题仅空行回填。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  searchAgentSession: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const deleteThreadMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("./checkpointer", () => ({ deleteThread: deleteThreadMock }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import {
  backfillSessionTitle,
  createSession,
  deleteSession,
  deriveTitle,
  touchSessionAfterRun,
} from "./sessions";

beforeEach(() => {
  for (const m of Object.values(prismaMock.searchAgentSession)) m.mockReset();
  deleteThreadMock.mockReset();
  deleteThreadMock.mockResolvedValue(undefined);
});

describe("deriveTitle", () => {
  it("首行前 20 码点(汉字无截半问题)", () => {
    expect(deriveTitle("这是一个超过二十个汉字的标题用来验证码点截断行为正确")).toBe(
      "这是一个超过二十个汉字的标题用来验证码点",
    );
  });
  it("多行取首行(trim 吃前导空行);全空白回落「新会话」", () => {
    expect(deriveTitle("第一行\n第二行")).toBe("第一行");
    expect(deriveTitle("  \n\n正文")).toBe("正文");
    expect(deriveTitle("")).toBe("新会话");
    expect(deriveTitle("   \n  ")).toBe("新会话");
  });
});

describe("deleteSession", () => {
  it("归属校验通过:行+checkpoint 同删", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "v-1" });
    prismaMock.searchAgentSession.delete.mockResolvedValue({});
    await expect(deleteSession("v-1", "t-1")).resolves.toBe(true);
    expect(prismaMock.searchAgentSession.delete).toHaveBeenCalledWith({ where: { id: "t-1" } });
    expect(deleteThreadMock).toHaveBeenCalledWith("t-1");
  });

  it("非本人/不存在 → false 且不触删(404 不泄露存在性)", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "other" });
    await expect(deleteSession("v-1", "t-1")).resolves.toBe(false);
    prismaMock.searchAgentSession.findUnique.mockResolvedValue(null);
    await expect(deleteSession("v-1", "t-2")).resolves.toBe(false);
    expect(prismaMock.searchAgentSession.delete).not.toHaveBeenCalled();
    expect(deleteThreadMock).not.toHaveBeenCalled();
  });

  it("checkpoint 删失败:行已删返 true,只告警(30 天日清兜底)", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "v-1" });
    prismaMock.searchAgentSession.delete.mockResolvedValue({});
    deleteThreadMock.mockRejectedValue(new Error("cp down"));
    await expect(deleteSession("v-1", "t-1")).resolves.toBe(true);
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});

describe("createSession/touch/backfill", () => {
  it("create 用 uuid 建行", async () => {
    prismaMock.searchAgentSession.create.mockResolvedValue({});
    const { id } = await createSession("v-1");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(prismaMock.searchAgentSession.create).toHaveBeenCalledWith({
      data: { id, visitorId: "v-1" },
    });
  });

  it("touch:tokens 正数累计", async () => {
    prismaMock.searchAgentSession.update.mockResolvedValue({});
    await touchSessionAfterRun("t-1", 320);
    expect(prismaMock.searchAgentSession.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ tokensTotal: { increment: 320 } }),
    });
  });

  it("backfill 仅回填 title 为空的行(updateMany 条件)", async () => {
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 1 });
    await backfillSessionTitle("t-1", "问个问题");
    expect(prismaMock.searchAgentSession.updateMany).toHaveBeenCalledWith({
      where: { id: "t-1", title: null },
      data: { title: "问个问题" },
    });
  });
});
