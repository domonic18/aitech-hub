/** 簇视图读侧单测(prisma mock,无真库;承重墙补盲 M47 批C,M47 批D 跟随实现迁 cluster-view):
 * listInsightClusters 的 take 钳制/kind 过滤/二次聚合映射/异动动量判定,
 * getInsightClusterDetail 的 404 null/快照升序反转/来源分布降序/bigint 出参。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const clusterFindMany = vi.fn();
const clusterFindUnique = vi.fn();
const memberGroupBy = vi.fn();
const memberCount = vi.fn();
const snapFindMany = vi.fn();
const signalFindMany = vi.fn();
const signalGroupBy = vi.fn();
const rawQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    insightCluster: {
      findMany: (...a: unknown[]) => clusterFindMany(...a),
      findUnique: (...a: unknown[]) => clusterFindUnique(...a),
    },
    insightClusterMember: {
      groupBy: (...a: unknown[]) => memberGroupBy(...a),
      count: (...a: unknown[]) => memberCount(...a),
    },
    insightSnapshot: { findMany: (...a: unknown[]) => snapFindMany(...a) },
    insightSignal: {
      findMany: (...a: unknown[]) => signalFindMany(...a),
      groupBy: (...a: unknown[]) => signalGroupBy(...a),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
      rawQuery(strings, ...values),
  },
}));

import { getInsightClusterDetail, listInsightClusters } from "./cluster-view";

beforeEach(() => {
  vi.clearAllMocks();
});

function clusterRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: BigInt(11),
    kind: "hot",
    status: "active",
    label: "MCP 生态",
    summary: "MCP 相关讨论升温",
    keywords: ["mcp", 1, null],
    media: ["bilibili", 42],
    score: 8.5,
    coverageScore: 0.4,
    coverageState: "blank",
    ...overrides,
  };
}

/** 两簇成员/快照/动量聚合的标准桩;M60 批C 起榜单先按成员门槛取 id 再取行 */
function mockTwoClusters(): void {
  rawQuery.mockResolvedValue([{ id: BigInt(11) }, { id: BigInt(22) }]);
  clusterFindMany.mockResolvedValue([
    clusterRow(),
    clusterRow({ id: BigInt(22), label: null, score: null, keywords: [], media: [] }),
  ]);
  memberGroupBy.mockResolvedValue([{ clusterId: BigInt(11), _count: { _all: 7 } }]);
  snapFindMany.mockResolvedValue([
    { clusterId: BigInt(11), score: 2 },
    { clusterId: BigInt(11), score: 6 },
  ]);
  // ② 动量聚合(① 是成员门槛取 id 的 SQL,由各用例自设)
  rawQuery.mockResolvedValueOnce([{ id: BigInt(11) }, { id: BigInt(22) }]).mockResolvedValue([
    {
      cluster_id: BigInt(11),
      sig_24h: BigInt(5),
      sig_before: BigInt(3),
      recent: new Date("2026-10-24T02:00:00Z"),
    },
  ] as never);
}

/** 从 rawQuery 调用里取出嵌套 Sql 片段(Prisma.sql 片段不展开进 strings) */
type SqlFragment = { strings: string[]; values: unknown[] };
function fragmentsOf(call: unknown[]): SqlFragment[] {
  return call
    .slice(1)
    .filter(
      (v): v is SqlFragment =>
        typeof v === "object" && v !== null && Array.isArray((v as SqlFragment).strings),
    );
}

describe("listInsightClusters", () => {
  it("成员门槛取 id 后为空 → 返回 [] 且不触发二次聚合", async () => {
    rawQuery.mockResolvedValue([]);
    const rows = await listInsightClusters({});
    expect(rows).toEqual([]);
    expect(rawQuery).toHaveBeenCalledTimes(1);
    expect(clusterFindMany).not.toHaveBeenCalled();
    expect(memberGroupBy).not.toHaveBeenCalled();
  });

  it("成员门槛 SQL:take 钳制 [1,50] 与 kind 过滤进 fragments", async () => {
    rawQuery.mockResolvedValue([]);
    await listInsightClusters({ kind: "pain", limit: 999 });
    expect(clusterFindMany).not.toHaveBeenCalled();
    const call = rawQuery.mock.calls[0] as unknown[];
    expect(call.slice(1)).toContain(50);
    const frags = fragmentsOf(call);
    expect(frags.some((f) => f.strings.join("?").includes("c.kind = ?"))).toBe(true);
    expect(frags.flatMap((f) => f.values)).toContain("pain");
    // 成员门是子查询(constant 绑定 LABEL_MIN_MEMBERS=3)
    expect((call[0] as TemplateStringsArray).join("?")).toContain("insight_cluster_member m");
    expect(call.slice(1)).toContain(3);

    await listInsightClusters({ limit: 0 });
    expect((rawQuery.mock.calls[1] as unknown[]).slice(1)).toContain(1);
  });

  it("领域过滤进 fragments,undefined 不筛(M54 批C)", async () => {
    rawQuery.mockResolvedValue([]);
    await listInsightClusters({ domain: "tech" });
    const withDomain = fragmentsOf(rawQuery.mock.calls[0] as unknown[]);
    expect(withDomain.flatMap((f) => f.values)).toContain("tech");
    expect(withDomain.some((f) => f.strings.join("?").includes("c.domain = ?"))).toBe(true);

    await listInsightClusters({});
    const noDomain = fragmentsOf(rawQuery.mock.calls[1] as unknown[]);
    expect(noDomain.flatMap((f) => f.values)).not.toContain("tech");
  });

  it("映射:成员数/快照升序 history/动量与异动/非串词面滤除/时间 ISO 化", async () => {
    mockTwoClusters();
    const rows = await listInsightClusters({});
    expect(rows).toHaveLength(2);
    const hot = rows[0]!;
    expect(hot.id).toBe("11");
    expect(hot.members).toBe(7);
    expect(hot.history).toEqual([2, 6]);
    // 24h≥3 且此前>2 但占比 5/8≥40% → rising;recent ISO 化
    expect(hot.momentum).toBe("rising");
    expect(hot.sig24h).toBe(5);
    expect(hot.sigBefore).toBe(3);
    expect(hot.recentAt).toBe("2026-10-24T02:00:00.000Z");
    expect(hot.keywords).toEqual(["mcp"]);
    expect(hot.media).toEqual(["bilibili"]);
    // 无聚合行的簇:成员 0/动量 steady/recentAt null
    const orphan = rows[1]!;
    expect(orphan.members).toBe(0);
    expect(orphan.momentum).toBe("steady");
    expect(orphan.recentAt).toBeNull();
    expect(orphan.history).toEqual([]);
    expect(orphan.anomaly).toBe(false);
  });
});

describe("getInsightClusterDetail", () => {
  it("簇不存在 → null(交 notFound)", async () => {
    clusterFindUnique.mockResolvedValue(null);
    expect(await getInsightClusterDetail(BigInt(1))).toBeNull();
    expect(memberCount).not.toHaveBeenCalled();
  });

  it("映射:快照 desc 取尾反转升序+日期切片/信号流与来源分布/成员数直传", async () => {
    clusterFindUnique.mockResolvedValue(
      clusterRow({
        domain: "devtool",
        labeledAt: new Date("2026-10-20T00:00:00Z"),
        firstSeenAt: new Date("2026-10-01T00:00:00Z"),
        lastSeenAt: new Date("2026-10-24T00:00:00Z"),
        peakAt: null,
      }),
    );
    memberCount.mockResolvedValue(7);
    snapFindMany.mockResolvedValue([
      { date: new Date("2026-10-23T00:00:00Z"), score: 6, rank: 2 },
      { date: new Date("2026-10-22T00:00:00Z"), score: 2, rank: null },
    ]);
    signalFindMany.mockResolvedValue([
      {
        id: BigInt(900),
        source: "telegram-ai",
        rawText: "mcp 又出新客户端",
        signalAt: new Date("2026-10-24T01:00:00Z"),
        meta: { url: "https://t.co/x" },
      },
    ]);
    signalGroupBy.mockResolvedValue([
      { source: "hot-baidu", _count: { _all: 3 } },
      { source: "telegram-ai", _count: { _all: 9 } },
    ]);

    const d = await getInsightClusterDetail(BigInt(11));
    expect(d).not.toBeNull();
    const c = d!.cluster;
    expect(c.id).toBe("11");
    expect(c.domain).toBe("devtool");
    expect(c.members).toBe(7);
    expect(c.recentAt).toBeNull();
    expect(c.labeledAt).toBe("2026-10-20T00:00:00.000Z");
    expect(c.peakAt).toBeNull();
    // desc 查询反转回升序,日期取 ISO 前十位
    expect(c.snapshots).toEqual([
      { date: "2026-10-22", score: 2, rank: null },
      { date: "2026-10-23", score: 6, rank: 2 },
    ]);
    expect(d!.signals).toHaveLength(1);
    expect(d!.signals[0]!.id).toBe("900");
    expect(d!.signals[0]!.meta).toEqual({ url: "https://t.co/x" });
    // 来源分布降序
    expect(d!.sourceDist).toEqual([
      { source: "telegram-ai", count: 9 },
      { source: "hot-baidu", count: 3 },
    ]);
  });
});
