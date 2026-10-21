/**
 * 样例参照图库行治理单测(M39 批③,全 mock prisma):展示名派生(去扩展/
 * 空回落/截 100)/ 列表与登记 BigInt→string 投影 / 重命名不存在回 null /
 * 删除事务先置空 topic 引用再删行(false=行不存在,媒体不连带口径在调用侧)。
 * 路由鉴权/Origin 归共享守卫(session-guard 既有覆盖),端到端归批⑤ e2e。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  writingSampleImage: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  topic: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../db", () => ({ prisma }));

import {
  createWritingSample,
  deleteWritingSample,
  deriveSampleName,
  listWritingSamples,
  renameWritingSample,
} from "./writing-samples";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveSampleName(展示名派生)", () => {
  it("去扩展名;空名回落;超长截 100", () => {
    expect(deriveSampleName("ref-style.png")).toBe("ref-style");
    expect(deriveSampleName("  参考图.JPG ")).toBe("参考图");
    expect(deriveSampleName("")).toBe("样例参照图");
    expect(deriveSampleName(".png")).toBe("样例参照图");
    expect(deriveSampleName("x".repeat(120))).toHaveLength(100);
  });
});

describe("图库行 CRUD(prisma 投影)", () => {
  const ROW = {
    id: BigInt(7),
    name: "金句卡风格",
    mediaPath: "/wp-content/uploads/2026/10/abc.jpg",
    createdAt: new Date("2026-10-21T00:00:00Z"),
  };

  it("listWritingSamples:id→string、时间 ISO,createdAt 倒序取数", async () => {
    prisma.writingSampleImage.findMany.mockResolvedValueOnce([ROW]);
    const rows = await listWritingSamples();
    expect(prisma.writingSampleImage.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "desc" }],
    });
    expect(rows).toEqual([
      {
        id: "7",
        name: "金句卡风格",
        mediaPath: "/wp-content/uploads/2026/10/abc.jpg",
        createdAt: "2026-10-21T00:00:00.000Z",
      },
    ]);
  });

  it("createWritingSample:登记行并投影", async () => {
    prisma.writingSampleImage.create.mockResolvedValueOnce(ROW);
    const row = await createWritingSample("金句卡风格", ROW.mediaPath);
    expect(prisma.writingSampleImage.create).toHaveBeenCalledWith({
      data: { name: "金句卡风格", mediaPath: ROW.mediaPath },
    });
    expect(row.id).toBe("7");
  });

  it("renameWritingSample:更新失败(行已删)回 null", async () => {
    prisma.writingSampleImage.update.mockResolvedValueOnce(ROW);
    expect((await renameWritingSample(BigInt(7), "新名"))?.name).toBe("金句卡风格");
    prisma.writingSampleImage.update.mockRejectedValueOnce(new Error("P2025"));
    await expect(renameWritingSample(BigInt(7), "新名")).resolves.toBeNull();
  });

  it("deleteWritingSample:事务置空 topic 引用 + 删行;返回行存在性", async () => {
    prisma.topic.updateMany.mockResolvedValueOnce({ count: 2 });
    prisma.writingSampleImage.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.$transaction.mockImplementationOnce(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops),
    );
    await expect(deleteWritingSample(BigInt(7))).resolves.toBe(true);
    expect(prisma.topic.updateMany).toHaveBeenCalledWith({
      where: { sampleImageId: BigInt(7) },
      data: { sampleImageId: null },
    });
    expect(prisma.writingSampleImage.deleteMany).toHaveBeenCalledWith({ where: { id: BigInt(7) } });

    prisma.topic.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.writingSampleImage.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.$transaction.mockImplementationOnce(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops),
    );
    await expect(deleteWritingSample(BigInt(7))).resolves.toBe(false);
  });
});
