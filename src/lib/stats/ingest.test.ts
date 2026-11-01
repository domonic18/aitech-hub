/**
 * 统计接收入口单测(M48 批G 补盲;redis/prisma 必 mock):beacon 三闸(bot/管理员/
 * UV 去重)、缓冲键形与 uv 条件写入、文章 PV 1h 去重与发布态负缓存、搜索词链路、
 * 爬虫/GEO 键形、purge 分批。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => {
  const pipe = {
    hincrby: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn(async () => []),
  };
  pipe.hincrby.mockReturnValue(pipe);
  pipe.expire.mockReturnValue(pipe);
  return {
    set: vi.fn(),
    get: vi.fn(),
    hincrby: vi.fn(),
    pipeline: vi.fn(() => pipe),
    pipe,
  };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const prismaMock = vi.hoisted(() => ({
  statsVisitLog: { create: vi.fn() },
  statsSearchLog: { create: vi.fn() },
  post: { findUnique: vi.fn() },
  statsVisitLogDelegate: null,
  statsSearchLogDelegate: null,
  jobRun: { findMany: vi.fn(), deleteMany: vi.fn() },
  statsVisitLogDel: { findMany: vi.fn(), deleteMany: vi.fn() },
  statsSearchLogDel: { findMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  // deleteBatchedWhere 走真身(批F),prisma 换 mock
  ...(await importOriginal<object>()),
  prisma: {
    ...prismaMock,
    statsVisitLog: {
      ...prismaMock.statsVisitLog,
      findMany: prismaMock.statsVisitLogDel.findMany,
      deleteMany: prismaMock.statsVisitLogDel.deleteMany,
    },
    statsSearchLog: {
      ...prismaMock.statsSearchLog,
      findMany: prismaMock.statsSearchLogDel.findMany,
      deleteMany: prismaMock.statsSearchLogDel.deleteMany,
    },
    jobRun: prismaMock.jobRun,
  },
}));

const insightMock = vi.hoisted(() => ({ ingestInsightSignal: vi.fn(async () => undefined) }));
vi.mock("@/lib/insight/ingest", () => insightMock);
const onlineMock = vi.hoisted(() => ({ touchPresence: vi.fn(async () => undefined) }));
vi.mock("./online", () => onlineMock);

import { ingestBotFetch, ingestGeoFetch, ingestView, purgeVisitLogs } from "./service";

const SALT = "test-salt";
const UA = "Mozilla/5.0 (Macintosh) Chrome/120";

function baseInput(over: Partial<Parameters<typeof ingestView>[0]> = {}) {
  return {
    path: "/articles/",
    referrer: "https://www.google.com/",
    ua: UA,
    ip: "1.2.3.4",
    salt: SALT,
    isAdmin: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.set.mockResolvedValue("OK");
  redisMock.get.mockResolvedValue(null);
  prismaMock.statsVisitLog.create.mockResolvedValue({
    id: BigInt(1),
    createdAt: new Date("2026-10-25T00:00:00Z"),
  });
  prismaMock.statsSearchLog.create.mockResolvedValue({
    id: BigInt(2),
    createdAt: new Date("2026-10-25T00:00:00Z"),
  });
  prismaMock.statsVisitLogDel.findMany.mockResolvedValue([]);
  prismaMock.statsVisitLogDel.deleteMany.mockResolvedValue({ count: 0 });
});

describe("ingestView 三闸与缓冲键形", () => {
  it("bot UA → 不入账,零 Redis 写", async () => {
    const r = await ingestView(baseInput({ ua: "GPTBot/1.0" }));
    expect(r).toEqual({ counted: false, reason: "bot", postCounted: false });
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  it("管理员 → 不入账", async () => {
    const r = await ingestView(baseInput({ isAdmin: true }));
    expect(r.reason).toBe("admin");
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  it("首访(UV NX=OK):pv/uv 双写 + ref 双行 + page 双行", async () => {
    const r = await ingestView(baseInput());
    expect(r.counted).toBe(true);
    const buf = redisMock.pipe.hincrby.mock.calls.map((c) => String(c[0]));
    // visit 键 pv+uv 两次同键调用
    expect(buf.filter((k) => k.startsWith("stats:buf:visit:")).length).toBe(2);
    // visit 键上有 pv + uv 两条
    const visitCalls = redisMock.pipe.hincrby.mock.calls.filter((c) =>
      String(c[0]).startsWith("stats:buf:visit:"),
    );
    expect(visitCalls.map((c) => c[1])).toEqual(["pv", "uv"]);
    // ref 键上 pv + uv 各一条,direct|google 分类
    const refCalls = redisMock.pipe.hincrby.mock.calls.filter((c) =>
      String(c[0]).startsWith("stats:buf:ref:"),
    );
    expect(refCalls.map((c) => c[1])).toEqual(["search|google|pv", "search|google|uv"]);
    expect(redisMock.pipe.expire).toHaveBeenCalledTimes(5);
  });

  it("回访(UV NX=null):只写 pv,不写 uv", async () => {
    redisMock.set.mockResolvedValue(null);
    await ingestView(baseInput());
    const visitFields = redisMock.pipe.hincrby.mock.calls
      .filter((c) => String(c[0]).startsWith("stats:buf:visit:"))
      .map((c) => c[1]);
    expect(visitFields).toEqual(["pv"]);
  });

  it("文章页首读:发布态解析→1h 去重 NX→post 缓冲,postCounted=true", async () => {
    prismaMock.post.findUnique.mockResolvedValue({
      status: "published",
      publishedAt: new Date("2026-10-01T00:00:00Z"),
    });
    // set 调用序:uv/uvp(OK)→ postmap(get 走 null)→ pvp(OK)——按 key 前缀分发
    redisMock.set.mockImplementation(async (key: string) =>
      key.startsWith("stats:pvp:") ? "OK" : "OK",
    );
    const r = await ingestView(baseInput({ path: "/post/12-some-slug/" }));
    expect(r.postCounted).toBe(true);
    expect(prismaMock.post.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: expect.anything() } }),
    );
    // 文章 PV 走 pipeline 写 post 缓冲(与其余五类同口径,含兜底 TTL)
    const postCall = redisMock.pipe.hincrby.mock.calls.find((c) =>
      String(c[0]).startsWith("stats:buf:post:"),
    );
    expect(postCall?.[1]).toBe("12");
    expect(redisMock.pipe.expire).toHaveBeenCalledWith(
      expect.stringMatching(/^stats:buf:post:\d{4}-\d{2}-\d{2}$/),
      172800,
    );
  });

  it("1h 窗内重复读:pvp NX=null → 不计", async () => {
    redisMock.set.mockImplementation(async (key: string) =>
      key.startsWith("stats:pvp:") ? null : "OK",
    );
    const r = await ingestView(baseInput({ path: "/post/12-some-slug/" }));
    expect(r.postCounted).toBe(false);
    // 1h 窗内重复:post 缓冲零写入(发布态 postmap 本测独立,解析照走查库)
    expect(
      redisMock.pipe.hincrby.mock.calls.some((c) => String(c[0]).startsWith("stats:buf:post:")),
    ).toBe(false);
  });

  it("非文章路径 → postCounted=false 且零 post 缓冲", async () => {
    const r = await ingestView(baseInput({ path: "/about/" }));
    expect(r.postCounted).toBe(false);
    expect(
      redisMock.pipe.hincrby.mock.calls.some((c) => String(c[0]).startsWith("stats:buf:post:")),
    ).toBe(false);
  });

  it("/search 带 q:搜索词行直插 + 链式入洞察信号", async () => {
    await ingestView(baseInput({ path: "/search/", q: "  claude code  " }));
    expect(prismaMock.statsSearchLog.create).toHaveBeenCalledTimes(1);
    expect(insightMock.ingestInsightSignal).toHaveBeenCalledWith(
      expect.objectContaining({ source: "internal-search", refId: "2" }),
    );
  });
});

describe("爬虫 / GEO 入账键形", () => {
  it("ingestBotFetch:bot|名称|pv 单字段", async () => {
    await ingestBotFetch("GPTBot");
    expect(redisMock.pipe.hincrby).toHaveBeenCalledWith(
      expect.stringContaining("stats:buf:ref:"),
      "bot|GPTBot|pv",
      1,
    );
  });

  it("ingestGeoFetch:面|爬虫|文章id 键形", async () => {
    await ingestGeoFetch("post_md", "ClaudeBot", "/post/12-slug.md");
    expect(redisMock.pipe.hincrby).toHaveBeenCalledWith(
      expect.stringContaining("stats:buf:geo:"),
      "post_md|ClaudeBot|12",
      1,
    );
  });
});

describe("purgeVisitLogs 分批(批F 装配)", () => {
  it("批取 id → in 删,行数回传", async () => {
    prismaMock.statsVisitLogDel.findMany
      .mockResolvedValueOnce([{ id: BigInt(1) }, { id: BigInt(2) }])
      .mockResolvedValueOnce([]);
    await expect(purgeVisitLogs()).resolves.toBe(2);
    expect(prismaMock.statsVisitLogDel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(prismaMock.statsVisitLogDel.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(1), BigInt(2)] } },
    });
  });
});
