/**
 * admin ↔ 飞书绑定单测(prisma/logger 全 mock):跨锚冲突(unionId 被他人
 * 占用)409、自绑/换绑 upsert、解绑幂等(false=无绑定)、兑换侧 union 精确查。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    adminFeishuBinding: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from "../db";
import { bindFeishu, findBindingByUnion, getBindingForUser, unbindFeishu } from "./feishu-binding";

const mockedFind = vi.mocked(prisma.adminFeishuBinding.findUnique);
const mockedUpsert = vi.mocked(prisma.adminFeishuBinding.upsert);
const mockedDelete = vi.mocked(prisma.adminFeishuBinding.delete);

const IDENTITY = { unionId: "ou-union", openId: "ou-open", name: "张三" };

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: BigInt(1),
    userId: BigInt(10),
    unionId: "ou-union",
    openId: "ou-open",
    feishuName: "张三",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBindingForUser", () => {
  it("无绑定 null;有绑定回视图(boundAt ISO)", async () => {
    mockedFind.mockResolvedValueOnce(null);
    expect(await getBindingForUser(BigInt(10))).toBeNull();

    mockedFind.mockResolvedValueOnce(row() as never);
    expect(await getBindingForUser(BigInt(10))).toEqual({
      feishuName: "张三",
      openId: "ou-open",
      boundAt: "2026-10-14T00:00:00.000Z",
    });
  });
});

describe("bindFeishu", () => {
  it("unionId 被其他账号占用 → FeishuError(conflict)", async () => {
    mockedFind.mockResolvedValueOnce(row({ userId: BigInt(99) }) as never);
    await expect(bindFeishu(BigInt(10), IDENTITY)).rejects.toMatchObject({ code: "conflict" });
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("未占用 → upsert 落绑定;换绑(同账号旧 union 行)照常 upsert", async () => {
    mockedFind.mockResolvedValueOnce(null);
    mockedUpsert.mockResolvedValueOnce(row() as never);
    const view = await bindFeishu(BigInt(10), IDENTITY);
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: BigInt(10) } }),
    );
    expect(view.feishuName).toBe("张三");

    mockedFind.mockResolvedValueOnce(row() as never); // union 命中本人
    mockedUpsert.mockResolvedValueOnce(row({ unionId: "ou-new" }) as never);
    await bindFeishu(BigInt(10), { ...IDENTITY, unionId: "ou-new" });
    const data = mockedUpsert.mock.calls[1][0].update as Record<string, unknown>;
    expect(data.unionId).toBe("ou-new");
  });
});

describe("unbindFeishu", () => {
  it("无绑定 false 不删;有绑定删并 true", async () => {
    mockedFind.mockResolvedValueOnce(null);
    expect(await unbindFeishu(BigInt(10))).toBe(false);
    expect(mockedDelete).not.toHaveBeenCalled();

    mockedFind.mockResolvedValueOnce(row() as never);
    mockedDelete.mockResolvedValueOnce(row() as never);
    expect(await unbindFeishu(BigInt(10))).toBe(true);
    expect(mockedDelete).toHaveBeenCalledWith({ where: { userId: BigInt(10) } });
  });
});

describe("findBindingByUnion", () => {
  it("unionId 精确查透传 prisma", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    expect(await findBindingByUnion("ou-union")).toMatchObject({ userId: BigInt(10) });
    expect(mockedFind).toHaveBeenCalledWith({ where: { unionId: "ou-union" } });
  });
});
