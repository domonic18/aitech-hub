/**
 * 条目点击域单测(M28 批①;prisma/logger 必 mock):域名解析(外链/站内/超长)、
 * ingestClick 行级直插形状与失败只告警不反噬、purge 180 天 cutoff、
 * getHotClicks 三路标题反解与删除占位、getClickDomains 外链域名分布。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  statsClickLog: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  telegram: { findMany: vi.fn() },
  post: { findMany: vi.fn() },
  githubRepo: { findMany: vi.fn() },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("../db", async (importOriginal) => ({
  // M48 批F:purge 走真身 deleteBatchedWhere(prisma mock 只换连接),helper 不 mock
  ...(await importOriginal<object>()),
  prisma: prismaMock,
}));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { domainOf, getClickDomains, getHotClicks, ingestClick, purgeClickLogs } from "./clicks";

beforeEach(() => {
  for (const m of [
    prismaMock.statsClickLog.create,
    prismaMock.statsClickLog.deleteMany,
    prismaMock.statsClickLog.groupBy,
    prismaMock.telegram.findMany,
    prismaMock.post.findMany,
    prismaMock.githubRepo.findMany,
  ]) {
    m.mockReset();
  }
  prismaMock.statsClickLog.create.mockResolvedValue({});
});

describe("domainOf(服务端域名解析,不信任客户端)", () => {
  it("外链 URL 取 hostname;站内路径返空串", () => {
    expect(domainOf("https://www.bilibili.com/video/BVxx?a=1")).toBe("www.bilibili.com");
    expect(domainOf("/projects/doocs-md/")).toBe("");
    expect(domainOf("不是 URL")).toBe("");
  });

  it("超长 hostname 截 100(表上限)", () => {
    expect(domainOf(`https://${"a".repeat(300)}.com/`).length).toBe(100);
  });
});

describe("ingestClick(行级直插,失败只告警)", () => {
  it("直插 surface/kind/ref,域名从 target 解析", () => {
    ingestClick({
      surface: "home",
      kind: "telegram",
      ref: "123",
      target: "https://v.douyin.com/x/",
    });
    expect(prismaMock.statsClickLog.create).toHaveBeenCalledWith({
      data: { surface: "home", kind: "telegram", ref: "123", domain: "v.douyin.com" },
    });
  });

  it("create 失败仅告警不向上抛(beacon 不重试)", async () => {
    prismaMock.statsClickLog.create.mockRejectedValue(new Error("db down"));
    ingestClick({ surface: "telegram", kind: "post", ref: "7", target: "/post/7-x/" });
    await new Promise((r) => setImmediate(r));
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "stats.click_log.failed" }),
    );
  });
});

describe("purgeClickLogs(180 天保留,循搜索词)", () => {
  it("批取 id → in 删(M48 批F 分批),cutoff 断言在 findMany where", async () => {
    const cutoff = new Date(Date.now() - 180 * 86_400_000);
    prismaMock.statsClickLog.findMany.mockResolvedValue([{ id: BigInt(11) }, { id: BigInt(12) }]);
    prismaMock.statsClickLog.deleteMany.mockResolvedValue({ count: 2 });
    await expect(purgeClickLogs()).resolves.toBe(2);
    const findArg = prismaMock.statsClickLog.findMany.mock.calls[0]![0] as {
      where: { createdAt: { lt: Date } };
      take: number;
    };
    const days = (Date.now() - findArg.where.createdAt.lt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(179.9);
    expect(days).toBeLessThan(180.1);
    expect(findArg.take).toBe(500);
    expect(prismaMock.statsClickLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(11), BigInt(12)] } },
    });
  });
});

describe("getHotClicks(kind+ref 聚合 + 三路标题反解)", () => {
  it("标题反解:telegram/post 按 id,project 按 slug;删除兜底占位", async () => {
    prismaMock.statsClickLog.groupBy.mockResolvedValue([
      // DB orderBy count desc 的返回序(mock 照实模拟)
      { kind: "telegram", ref: "11", _count: { _all: 6 } },
      { kind: "project", ref: "doocs-md", _count: { _all: 4 } },
      { kind: "telegram", ref: "99", _count: { _all: 2 } }, // 未命中 → 占位
      { kind: "post", ref: "7", _count: { _all: 1 } },
      { kind: "telegram", ref: "非数字", _count: { _all: 1 } }, // id 转换失败 → 占位
    ]);
    prismaMock.telegram.findMany.mockResolvedValue([{ id: BigInt(11), title: "电报标题" }]);
    prismaMock.githubRepo.findMany.mockResolvedValue([{ slug: "doocs-md", fullName: "doocs/md" }]);
    prismaMock.post.findMany.mockResolvedValue([{ id: BigInt(7), title: "文章标题" }]);

    const rows = await getHotClicks("7d");
    expect(rows).toEqual([
      { kind: "telegram", ref: "11", title: "电报标题", count: 6 },
      { kind: "project", ref: "doocs-md", title: "doocs/md", count: 4 },
      { kind: "telegram", ref: "99", title: "电报条目 #99", count: 2 },
      { kind: "post", ref: "7", title: "文章标题", count: 1 },
      { kind: "telegram", ref: "非数字", title: "电报条目 #非数字", count: 1 },
    ]);
  });

  it("空聚合零反查,直接返回空数组", async () => {
    prismaMock.statsClickLog.groupBy.mockResolvedValue([]);
    await expect(getHotClicks("today")).resolves.toEqual([]);
    expect(prismaMock.telegram.findMany).not.toHaveBeenCalled();
  });
});

describe("getClickDomains(仅外链入分母)", () => {
  it("where 带 domain not 空串与窗口 gte", async () => {
    prismaMock.statsClickLog.groupBy.mockResolvedValue([
      { domain: "v.douyin.com", _count: { _all: 9 } },
    ]);
    const rows = await getClickDomains("7d");
    expect(rows).toEqual([{ domain: "v.douyin.com", count: 9 }]);
    const arg = prismaMock.statsClickLog.groupBy.mock.calls[0]![0] as {
      where: { domain: { not: string }; createdAt?: { gte: Date } };
    };
    expect(arg.where.domain).toEqual({ not: "" });
    expect(arg.where.createdAt?.gte).toBeInstanceOf(Date);
  });
});
